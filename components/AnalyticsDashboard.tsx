import { useMemo, useState, useEffect } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import { X, PieChart as PieIcon, RefreshCcw } from 'lucide-react';
import { format, eachDayOfInterval, isSameDay, isSameMonth, startOfMonth, parseISO, isSameYear, subMonths, endOfMonth } from 'date-fns';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import DateFilter from './DateFilter';

interface ExpenseDetail {
  id: string;
  amount: number;
  addedDate: any; // Timestamp
  categoryName: string;
  expenseName: string;
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

interface Props {
  isOpen: boolean;
  onClose: () => void;
  // Lookups passed from parent to avoid refetching static configs
  expenseDefs: ExpenseMain[];
  categories: Category[];
}

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#06b6d4'
];

export default function AnalyticsDashboard({ isOpen, onClose, expenseDefs, categories }: Props) {
  // Independent State
  const [dateRange, setDateRange] = useState({
    start: subMonths(new Date(), 3),
    end: new Date()
  });
  const [filterMode, setFilterMode] = useState<'single' | 'range'>('range');
  const [expenses, setExpenses] = useState<ExpenseDetail[]>([]);
  const [loading, setLoading] = useState(false);

  // Drill-down state: null means showing all, Date means showing specific Slice
  const [focusedDate, setFocusedDate] = useState<{ date: Date, type: 'day' | 'month' } | null>(null);

  // Clear focus when dateRange changes
  useEffect(() => {
    setFocusedDate(null);
  }, [dateRange]);

  // Fetch Data Independently based on local Date Range
  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    const start = startOfMonth(dateRange.start);
    const end = endOfMonth(dateRange.end);

    const q = query(
      collection(db, 'expenseDetails'),
      where('addedDate', '>=', start),
      where('addedDate', '<=', end),
      orderBy('addedDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const details = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));

      // Process and Join Data
      const processed = details.map(detail => {
        const expenseDef = expenseDefs.find(e => e.id === detail.expenseId);
        const categoryDef = categories.find(c => c.id === (expenseDef?.category || detail.category));

        return {
          ...detail,
          expenseName: expenseDef?.name || 'Unknown',
          categoryName: categoryDef?.name || 'Uncategorized',
          amount: detail.amount || 0,
          addedDate: detail.addedDate
        };
      });

      setExpenses(processed);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isOpen, dateRange, expenseDefs, categories]);


  // Determine if we are in Monthly or Daily view for the Trend chart
  const isMonthlyView = useMemo(() => {
    const diffTime = Math.abs(dateRange.end.getTime() - dateRange.start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 32;
  }, [dateRange]);

  // Prepare Trend Data (Bar Chart)
  const trendData = useMemo(() => {
    if (isMonthlyView) {
      // Group by Month
      const groups: { [key: string]: { amount: number; date: Date } } = {};

      expenses.forEach(e => {
        const date = e.addedDate.toDate();
        // Use first day of month as key signature for sorting/grouping
        const key = format(startOfMonth(date), 'yyyy-MM-dd');

        if (!groups[key]) {
          groups[key] = { amount: 0, date: startOfMonth(date) };
        }
        groups[key].amount += e.amount;
      });

      // Convert to array and Sort by Date
      return Object.values(groups)
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map(item => ({
          name: format(item.date, 'MMM yyyy'),
          date: item.date,
          amount: item.amount,
          type: 'month' as const
        }));

    } else {
      // Daily
      const days = eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
      return days.map(day => {
        const amount = expenses
          .filter(e => isSameDay(e.addedDate.toDate(), day))
          .reduce((sum, e) => sum + e.amount, 0);
        return {
          name: format(day, 'dd MMM'),
          date: day,
          amount,
          type: 'day' as const
        };
      });
    }
  }, [expenses, dateRange, isMonthlyView]);

  // Prepare Category Data (Pie Chart) - Depends on Focus
  const categoryData = useMemo(() => {
    const groups: { [key: string]: number } = {};

    // Filter expenses based on drill-down focus
    const filteredExpenses = expenses.filter(e => {
      const expenseDate = e.addedDate.toDate();

      if (!focusedDate) return true; // No filter

      if (focusedDate.type === 'month') {
        return isSameMonth(expenseDate, focusedDate.date) && isSameYear(expenseDate, focusedDate.date);
      } else {
        // day
        return isSameDay(expenseDate, focusedDate.date);
      }
    });

    filteredExpenses.forEach(e => {
      const cat = e.categoryName || 'Uncategorized';
      if (cat === 'Investment') return;
      groups[cat] = (groups[cat] || 0) + e.amount;
    });

    return Object.entries(groups)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses, focusedDate]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between p-4 border-b border-gray-100 bg-white sticky top-0 z-10 gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className={`p-2 rounded-xl text-white bg-blue-600 shadow-sm`}>
            <PieIcon size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Analytics</h2>
            <p className="text-xs text-gray-500 font-medium">
              {focusedDate
                ? `Breakdown for ${focusedDate.type === 'month' ? format(focusedDate.date, 'MMMM yyyy') : format(focusedDate.date, 'dd MMM yyyy')}`
                : 'Overview'
              }
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          <DateFilter
            dateRange={dateRange}
            setDateRange={setDateRange}
            filterMode="range"
            setFilterMode={() => { }} // No-op as mode is fixed
            hideModeToggle={true}
          />
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-full transition-colors"
          >
            <X size={24} />
          </button>
        </div>
      </div>

      {/* Main Content - Unified Scrollable View */}
      <div className="flex-1 overflow-y-auto bg-gray-50/50">
        <div className="max-w-5xl mx-auto p-4 space-y-6">

          {loading && (
            <div className="flex justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-gray-900"></div>
            </div>
          )}

          {!loading && (
            <>
              {/* Trend Section (Top) */}
              <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    Trend Analysis
                    <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {isMonthlyView ? 'Monthly' : 'Daily'}
                    </span>
                  </h3>
                  {focusedDate && (
                    <button
                      onClick={() => setFocusedDate(null)}
                      className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium bg-blue-50 px-2 py-1 rounded-lg transition-colors"
                    >
                      <RefreshCcw size={12} />
                      Reset View
                    </button>
                  )}
                </div>

                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={trendData}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        dy={10}
                        minTickGap={30}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: '#9ca3af' }}
                        tickFormatter={(value) => `${value / 1000}k`}
                      />
                      <Tooltip
                        cursor={{ fill: '#eff6ff', opacity: 0.5 }}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: any) => [`Rs. ${(Number(value) || 0).toLocaleString()}`, 'Spent']}
                        labelStyle={{ color: '#6b7280', marginBottom: '0.25rem' }}
                      />
                      <Bar
                        dataKey="amount"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={50}
                        className="cursor-pointer"
                        onClick={(data: any) => {
                          const item = data.payload || data;
                          if (item && item.date) {
                            setFocusedDate({ date: item.date, type: item.type });
                          }
                        }}
                      >
                        {trendData.map((entry, index) => (
                          <Cell
                            key={`cell-${index}`}
                            fill={
                              focusedDate &&
                                ((focusedDate.type === 'day' && isSameDay(entry.date, focusedDate.date)) ||
                                  (focusedDate.type === 'month' && isSameMonth(entry.date, focusedDate.date)))
                                ? '#2563eb' // Active
                                : '#93c5fd' // Inactive (Lighter blue)
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {trendData.length === 0 && (
                  <div className="text-center text-gray-400 text-sm py-4">No data available for this range</div>
                )}
              </div>

              {/* Category Section (Bottom) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-white p-6 rounded-2xl shadow-sm border border-gray-100 animate-in slide-in-from-bottom-4 duration-500">

                {/* Chart Side */}
                <div className="h-[300px] w-full relative flex items-center justify-center">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={80}
                        outerRadius={110}
                        paddingAngle={4}
                        dataKey="value"
                        stroke="none"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: any) => `Rs. ${(Number(value) || 0).toLocaleString()}`}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Center Total */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <div className="text-center">
                      <span className="text-xs text-gray-400 uppercase tracking-widest font-semibold mb-1">
                        {focusedDate ? 'Selected' : 'Total'}
                      </span>
                      <p className="text-2xl font-bold text-gray-900 tracking-tight">
                        {categoryData.reduce((acc, curr) => acc + curr.value, 0).toLocaleString()}
                      </p>
                      <span className="text-[10px] text-gray-400 font-medium">INR</span>
                    </div>
                  </div>
                </div>

                {/* Legend Side */}
                <div className="flex flex-col justify-center">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-gray-900">Category Breakdown</h3>
                    {focusedDate && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-md font-medium">
                        Filtered
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                    {categoryData.map((entry, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2.5 hover:bg-gray-50 rounded-lg transition-colors group"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                          <span className="text-sm font-medium text-gray-600 group-hover:text-gray-900 transition-colors">
                            {entry.name}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-sm font-bold text-gray-900">Rs. {entry.value.toLocaleString()}</span>
                          <span className="text-[10px] text-gray-400">
                            {((entry.value / categoryData.reduce((acc, c) => acc + c.value, 0)) * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    ))}
                    {categoryData.length === 0 && (
                      <div className="text-center text-gray-400 py-4 text-sm">No expenses found for this selection</div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
