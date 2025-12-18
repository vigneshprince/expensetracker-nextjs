'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, getDocs, Timestamp, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format, isSameMonth, parseISO, isSameDay, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ChevronDown, ChevronUp, Plus, RefreshCw, LogOut, Pencil, Trash2, Search, Calendar, CalendarRange, RotateCcw, PieChart as PieChartIcon, X as XIcon } from 'lucide-react';
import AnalyticsDashboard from './AnalyticsDashboard';
import DateFilter from './DateFilter';
import { useAuth } from './AuthProvider';
import Image from 'next/image';
import AddExpenseModal from './AddExpenseModal';
import { FileText as FileIcon } from 'lucide-react';
import BillViewModal from './BillViewModal';
import VoiceInput from './VoiceInput';

interface ExpenseDetail {
  id: string;
  expenseId: string;
  amount: number;
  addedDate: Timestamp;
  notes: string;
  category?: string; // Legacy data might have it, or we join it
  bill?: string[]; // Array of bill URLs
  expenseName?: string;
  img?: string;
  // ... other fields
}

interface ExpenseMain {
  id: string;
  name: string;
  category: string;
  img: string;
}

interface Category {
  id: string;
  name: string;
}

interface GroupedExpense {
  category: string;
  totalAmount: number;
  expenses: (ExpenseDetail & { expenseName: string; img: string })[];
  isOpen: boolean;
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  // Dashboard defaults to Current Month (Single)
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date())
  });
  const [filterMode, setFilterMode] = useState<'single' | 'range'>('single');
  const [groupedData, setGroupedData] = useState<GroupedExpense[]>([]);
  const [totalExpense, setTotalExpense] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<ExpenseDetail | null>(null);
  const [initialModalData, setInitialModalData] = useState<any>(null); // For Voice Input Pre-fill
  const [viewingBills, setViewingBills] = useState<string[]>([]);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [showHeader, setShowHeader] = useState(true);

  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false); // Analytics State
  const [rawExpenses, setRawExpenses] = useState<any[]>([]); // Flat data for analytics

  const handleResetDate = () => {
    const now = new Date();
    setDateRange({ start: now, end: now });
    if (!searchQuery) {
      setFilterMode('single');
    }
  };

  // Cache for expenses and categories to avoid re-fetching constantly if they don't change often
  // But for now we fetch them once or on mount.
  const [expenseDefs, setExpenseDefs] = useState<ExpenseMain[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [allExpensesCache, setAllExpensesCache] = useState<ExpenseDetail[] | null>(null); // Cache for search

  // Scroll Handler for Hide/Show Header
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > 10 && currentScrollY > lastScrollY) {
        setShowHeader(false); // Hide on scroll down
      } else {
        setShowHeader(true); // Show on scroll up
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  useEffect(() => {
    setMounted(true);
    // Fetch static definitions once
    const fetchStatic = async () => {
      const expSnap = await getDocs(collection(db, 'expenses'));
      const catSnap = await getDocs(collection(db, 'categories'));

      const exps = expSnap.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseMain));
      const cats = catSnap.docs.map(d => ({ id: d.id, ...d.data() } as Category));

      setExpenseDefs(exps);
      setCategories(cats);
    };
    fetchStatic();
  }, []);

  useEffect(() => {
    if (expenseDefs.length === 0 || categories.length === 0) return;
    if (searchQuery.trim()) return; // Skip if searching

    setLoading(true);
    const start = startOfMonth(dateRange.start);
    const end = endOfMonth(dateRange.end);

    // Query expenseDetails
    const q = query(
      collection(db, 'expenseDetails'),
      where('addedDate', '>=', start),
      where('addedDate', '<=', end)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const details = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseDetail));

      // Process data
      const processed = details.map(detail => {
        const expenseDef = expenseDefs.find(e => e.id === detail.expenseId);
        const categoryDef = categories.find(c => c.id === (expenseDef?.category || detail.category)); // Fallback or use joined
        // Note: Legacy Status.js finds category from expenseDef.category

        const categoryName = categoryDef?.name || 'Uncategorized';

        return {
          ...detail,
          expenseName: expenseDef?.name || 'Unknown',
          img: expenseDef?.img || '',
          categoryName,
          category: categoryDef?.id // Ensure category ID is resolved for legacy data
        };
      });

      setRawExpenses(processed); // Update raw data for analytics

      // Group by Category
      const groups: { [key: string]: GroupedExpense } = {};
      let total = 0;

      processed.forEach(item => {
        if (item.categoryName === 'Investment') return; // Filter out Investment if needed like legacy

        if (!groups[item.categoryName]) {
          groups[item.categoryName] = {
            category: item.categoryName,
            totalAmount: 0,
            expenses: [],
            isOpen: false // Default closed
          };
        }
        groups[item.categoryName].totalAmount += item.amount;
        groups[item.categoryName].expenses.push(item);
        total += item.amount;
      });

      // Convert to array and sort
      const sortedGroups = Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);

      // Sort expenses within groups
      sortedGroups.forEach(g => {
        g.expenses.sort((a, b) => b.amount - a.amount);
      });

      // PRESREVE EXPANSION STATE
      setGroupedData(prev => {
        const resetGroups = sortedGroups.map(g => {
          // Find if this category was previously open
          const prevGroup = prev.find(p => p.category === g.category);
          if (prevGroup) {
            return { ...g, isOpen: prevGroup.isOpen };
          }
          return g;
        });
        return resetGroups;
      });

      setTotalExpense(total);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [dateRange, expenseDefs, categories, searchQuery]); // Updated dependency to dateRange

  // Search Effect
  useEffect(() => {
    if (!searchQuery.trim()) return;

    const performSearch = async () => {
      setLoading(true);
      let allData = allExpensesCache;

      // 1. Fetch All History if not cached
      if (!allData) {
        try {
          // Fetch ALL expenses ordered by date desc
          // Note: In a real large app, we might limit this, but for personal tracker < 10k docs is fine.
          const q = query(collection(db, 'expenseDetails'), orderBy('addedDate', 'desc'));
          const snapshot = await getDocs(q);
          allData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ExpenseDetail));
          setAllExpensesCache(allData);
        } catch (error) {
          console.error("Error fetching history for search:", error);
          setLoading(false);
          return;
        }
      }

      if (!allData || expenseDefs.length === 0 || categories.length === 0) {
        setLoading(false);
        return;
      }

      // 2. Filter locally
      const lowerQuery = searchQuery.toLowerCase();

      const filtered = allData.filter(detail => {
        const expenseDef = expenseDefs.find(e => e.id === detail.expenseId);
        const name = expenseDef?.name || '';
        const notes = detail.notes || '';

        const matchesQuery = name.toLowerCase().includes(lowerQuery) || notes.toLowerCase().includes(lowerQuery);

        // Date Logic for Search
        const expenseDate = detail.addedDate.toDate();
        const start = startOfMonth(dateRange.start);
        const end = endOfMonth(dateRange.end);
        const matchesDate = expenseDate >= start && expenseDate <= end;

        return matchesQuery && matchesDate;
      }).map(detail => {
        // Enhance detail same as main logic
        const expenseDef = expenseDefs.find(e => e.id === detail.expenseId);
        const categoryDef = categories.find(c => c.id === (expenseDef?.category || detail.category));
        const categoryName = categoryDef?.name || 'Uncategorized';

        return {
          ...detail,
          expenseName: expenseDef?.name || 'Unknown',
          img: expenseDef?.img || '',
          categoryName,
          category: categoryDef?.id
        };
      });

      // 3. Group by Month-Year (e.g. "December 2025")
      const groups: { [key: string]: GroupedExpense } = {};
      let total = 0;

      filtered.forEach(item => {
        const date = item.addedDate.toDate();
        const groupKey = format(date, 'MMMM yyyy'); // "December 2025"

        if (!groups[groupKey]) {
          groups[groupKey] = {
            category: groupKey, // Reuse category field for Group Header
            totalAmount: 0,
            expenses: [],
            isOpen: true // Default OPEN for search results so user sees them
          };
        }
        groups[groupKey].totalAmount += item.amount;
        groups[groupKey].expenses.push(item);
        total += item.amount;
      });

      // Sort Groups by Date (descending) - tricky as keys are strings. 
      // Ideally we sort based on the date of the first item in the group.
      const sortedGroups = Object.values(groups).sort((a, b) => {
        // Pick first expense date to compare
        const dateA = a.expenses[0]?.addedDate.toDate().getTime() || 0;
        const dateB = b.expenses[0]?.addedDate.toDate().getTime() || 0;
        return dateB - dateA;
      });

      // Sort expenses within groups
      sortedGroups.forEach(g => {
        g.expenses.sort((a, b) => b.amount - a.amount);
      });

      setGroupedData(sortedGroups);
      setTotalExpense(total);
      setLoading(false);
    };

    const timeoutId = setTimeout(() => {
      performSearch();
    }, 300); // Debounce 300ms

    return () => clearTimeout(timeoutId);
  }, [searchQuery, expenseDefs, categories, allExpensesCache, dateRange]); // Added dateRange dependency

  // Auto-expand date range when search starts
  useEffect(() => {
    if (searchQuery.trim() && filterMode !== 'range') {
      setFilterMode('range');
      // Set to a wide range (e.g. Jan 1, 2020 to Now) if user hasn't manually set a wide range?
      // Actually, user asked to "default to oldest date - latest date".
      // We can just set it to a fixed "old enough" date for now, or keep current if it's already wide.
      // Let's set it to 2020 for now as a safe default for this "migrated" app.
      setDateRange({
        start: new Date('2020-01-01'),
        end: new Date()
      });
    }
  }, [searchQuery]); // Run when query changes (checked inside to only act on start)

  const toggleGroup = (catName: string) => {
    setGroupedData(prev => prev.map(g =>
      g.category === catName ? { ...g, isOpen: !g.isOpen } : g
    ));
  };

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
      try {
        await deleteDoc(doc(db, 'expenseDetails', id));
      } catch (error) {
        console.error("Error deleting expense:", error);
        alert("Failed to delete expense.");
      }
    }
  };

  const handleEdit = (expense: ExpenseDetail) => {
    setEditingExpense(expense);
    setIsModalOpen(true);
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-48 font-sans">
      {/* Header */}
      <div className={`sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 p-4 transition-transform duration-300 ${showHeader ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="max-w-3xl mx-auto">
          {/* Top Row: Title & Actions */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Expense Tracker</h1>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAnalyticsOpen(true)}
                className="p-2 bg-purple-50 text-purple-600 rounded-full hover:bg-purple-100 transition-colors border border-purple-200 shrink-0"
                title="View Analytics"
              >
                <PieChartIcon size={20} />
              </button>

              <button
                onClick={handleResetDate}
                className="p-2 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors border border-gray-200 shrink-0"
                title="Reset to Current Month"
              >
                <RotateCcw size={18} />
              </button>

              <div className="w-px h-6 bg-gray-200 mx-1"></div>

              <button
                onClick={logout}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors shrink-0"
                title="Sign Out"
              >
                <LogOut size={20} strokeWidth={1.5} />
              </button>
            </div>
          </div>

          {/* Controls Row */}
          <div className="flex flex-col gap-3">
            {/* Search Bar */}
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search expenses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white border border-gray-200 text-gray-900 pl-10 pr-4 py-2.5 rounded-xl text-sm shadow-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                >
                  <span className="sr-only">Clear</span>
                  <XIcon />
                </button>
              )}
            </div>

            {/* Date & Total Row */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="sm:w-auto w-full flex justify-center sm:justify-start">
                <DateFilter
                  dateRange={dateRange}
                  setDateRange={setDateRange}
                  filterMode={filterMode}
                  setFilterMode={setFilterMode}
                  hideModeToggle={false}
                />
              </div>

              {/* Total Card */}
              <div className={`
                flex items-center gap-3 px-4 py-2 rounded-xl shadow-sm border border-gray-200
                ${searchQuery ? 'bg-amber-50 border-amber-200 w-full justify-between' : 'bg-white w-full sm:w-auto justify-center sm:justify-start ml-auto'}
              `}>
                <span className="text-xs text-gray-500 font-bold uppercase tracking-wider">
                  {searchQuery ? 'Search Total' : 'Total'}
                </span>
                <span className="font-bold text-lg text-gray-900">
                  Rs. {totalExpense.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {loading && (
          <div className="flex justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-900"></div>
          </div>
        )}

        {!loading && groupedData.length === 0 && (
          <div className="text-center py-20">
            <p className="text-gray-400 text-lg">No expenses found for this month.</p>
            <p className="text-gray-400 text-sm mt-2">Click the + button to add one.</p>
          </div>
        )}

        {groupedData.map((group) => (
          <div key={group.category} className="bg-white rounded-xl overflow-hidden shadow-sm border border-gray-200 group">
            <div
              className="flex justify-between items-center p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => toggleGroup(group.category)}
            >
              <h3 className="text-gray-700 font-medium text-lg">{group.category}</h3>
              <div className="flex items-center gap-4">
                <span className="text-gray-900 font-semibold">Rs. {group.totalAmount.toLocaleString()}</span>
                {group.isOpen ? (
                  <ChevronUp className="text-gray-400" size={20} />
                ) : (
                  <ChevronDown className="text-gray-400" size={20} />
                )}
              </div>
            </div>

            {group.isOpen && (
              <div className="border-t border-gray-100">
                {group.expenses.map((expense, index) => (
                  <div
                    key={expense.id}
                    onClick={() => handleEdit(expense)}
                    className={`
                        p-4 flex justify-between items-center hover:bg-gray-50 transition-colors cursor-pointer
                        ${index !== group.expenses.length - 1 ? 'border-b border-gray-100' : ''}
                    `}
                  >
                    {/* Left: Icon, Name, Date */}
                    <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
                      <div className="relative h-10 w-10 rounded-lg bg-gray-50 flex items-center justify-center border border-gray-100 overflow-hidden shrink-0">
                        {expense.img ? (
                          <Image
                            src={expense.img}
                            alt={expense.expenseName}
                            fill
                            className="object-cover"
                            sizes="40px"
                            quality={75}
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-4 w-4 bg-gray-200 rounded-full"></div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{expense.expenseName}</p>
                        <div className="flex flex-col sm:flex-row sm:gap-2 text-sm text-gray-500 mt-0.5">
                          <span className={expense.notes ? "truncate" : "hidden"}>{expense.notes}</span>
                          {expense.notes && <span className="hidden sm:inline text-gray-300">•</span>}

                          <span>{format(expense.addedDate.toDate(), 'MMM d')}</span>
                          {expense.bill && expense.bill.length > 0 && (
                            <>
                              <span className="hidden sm:inline text-gray-300">•</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingBills(expense.bill || []);
                                  setIsBillModalOpen(true);
                                }}
                                className="flex items-center gap-1 text-blue-500 hover:text-blue-700 hover:underline cursor-pointer"
                              >
                                <FileIcon size={14} />
                                <span className="text-xs">{expense.bill.length} Bill{expense.bill.length > 1 ? 's' : ''}</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Amount, Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-medium text-gray-900 whitespace-nowrap">Rs. {expense.amount.toLocaleString()}</span>
                      <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(expense);
                          }}
                          className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-all active:scale-95"
                          title="Edit"
                        >
                          <Pencil size={18} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(expense.id, expense.expenseName);
                          }}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-all active:scale-95"
                          title="Delete"
                        >
                          <Trash2 size={18} strokeWidth={1.5} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        onClick={() => {
          setEditingExpense(null);
          setInitialModalData(null);
          setIsModalOpen(true);
        }}
        className="fixed bottom-8 right-8 bg-gray-900/75 backdrop-blur-md hover:bg-black/90 text-white p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 border border-white/20 hover:shadow-xl z-20"
      >
        <Plus size={24} strokeWidth={2} />
      </button>

      {/* Voice Input */}
      <VoiceInput
        existingCategories={categories.map(c => c.name)}
        existingExpenses={expenseDefs.map(d => ({
          name: d.name,
          category: categories.find(c => c.id === d.category)?.name || 'Unknown'
        }))}
        onExpenseParsed={(data) => {
          setEditingExpense(null);
          setInitialModalData(data);
          setIsModalOpen(true);
        }}
      />

      {isModalOpen && (
        <AddExpenseModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setEditingExpense(null);
            setInitialModalData(null);
          }}
          categories={categories}
          expenseDefs={expenseDefs}
          editingExpense={editingExpense}
          initialData={initialModalData}
          onDelete={(id) => handleDelete(id, editingExpense?.expenseName || '')}
        />
      )
      }

      <AnalyticsDashboard
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        expenseDefs={expenseDefs}
        categories={categories}
      />

      {
        isBillModalOpen && (
          <BillViewModal
            isOpen={isBillModalOpen}
            onClose={() => setIsBillModalOpen(false)}
            bills={viewingBills}
        />
      )}
    </div>
  );
}
