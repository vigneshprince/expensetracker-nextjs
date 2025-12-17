'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, getDocs, Timestamp, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { format, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import { ChevronDown, ChevronUp, Plus, RefreshCw, LogOut } from 'lucide-react';
import { useAuth } from './AuthProvider';
import AddExpenseModal from './AddExpenseModal'; // We will create this next

interface ExpenseDetail {
  id: string;
  expenseId: string;
  amount: number;
  addedDate: Timestamp;
  notes: string;
  category?: string; // Legacy data might have it, or we join it
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
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [groupedData, setGroupedData] = useState<GroupedExpense[]>([]);
  const [totalExpense, setTotalExpense] = useState(0);
  const [loading, setLoading] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Cache for expenses and categories to avoid re-fetching constantly if they don't change often
  // But for now we fetch them once or on mount.
  const [expenseDefs, setExpenseDefs] = useState<ExpenseMain[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

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

    setLoading(true);
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);

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
          categoryName
        };
      });

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

      setGroupedData(sortedGroups);
      setTotalExpense(total);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [currentMonth, expenseDefs, categories]);

  const toggleGroup = (catName: string) => {
    setGroupedData(prev => prev.map(g =>
      g.category === catName ? { ...g, isOpen: !g.isOpen } : g
    ));
  };

  if (!mounted) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20 font-sans">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200 p-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-semibold text-gray-900 tracking-tight">Expense Tracker</h1>
            <button
              onClick={logout}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut size={20} strokeWidth={1.5} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <input
              type="month"
              className="bg-transparent text-gray-900 p-2 rounded-lg font-medium border border-gray-200 hover:bg-gray-100 focus:ring-2 focus:ring-gray-900 outline-none transition-all cursor-pointer"
              value={format(currentMonth, 'yyyy-MM')}
              onChange={(e) => setCurrentMonth(parseISO(e.target.value))}
            />
            <div className="flex flex-col items-end">
              <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">Total</span>
              <span className="font-semibold text-xl text-gray-900 mt-0.5">Rs. {totalExpense.toLocaleString()}</span>
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
                    className={`
                        p-4 flex justify-between items-center hover:bg-gray-50 transition-colors
                        ${index !== group.expenses.length - 1 ? 'border-b border-gray-100' : ''}
                    `}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-lg bg-gray-50 flex items-center justify-center border border-gray-100 overflow-hidden shrink-0">
                        {expense.img ? (
                          <img src={expense.img} alt={expense.expenseName} className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-4 w-4 bg-gray-200 rounded-full"></div>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{expense.expenseName}</p>
                        <div className="flex flex-col sm:flex-row sm:gap-2 text-sm text-gray-500 mt-0.5">
                          <span className={expense.notes ? "" : "hidden"}>{expense.notes}</span>
                          {expense.notes && <span className="hidden sm:inline text-gray-300">•</span>}
                          <span>{format(expense.addedDate.toDate(), 'MMM d')}</span>
                        </div>
                      </div>
                    </div>
                    <span className="font-medium text-gray-900 whitespace-nowrap">Rs. {expense.amount.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* FAB */}
      <button
        onClick={() => setIsModalOpen(true)}
        className="fixed bottom-8 right-8 bg-gray-900 hover:bg-black text-white p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 border border-transparent hover:shadow-xl z-20"
      >
        <Plus size={24} strokeWidth={2} />
      </button>

      {isModalOpen && (
        <AddExpenseModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          categories={categories}
          expenseDefs={expenseDefs}
        />
      )}
    </div>
  );
}
