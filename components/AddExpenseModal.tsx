'use client';

import { useState, useEffect } from 'react';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { X, Loader2, Camera } from 'lucide-react';

interface Category {
  id: string;
  name: string;
}

interface ExpenseMain {
  id: string;
  name: string;
  category: string;
  img: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  expenseDefs: ExpenseMain[];
}

export default function AddExpenseModal({ isOpen, onClose, categories, expenseDefs }: Props) {
  const [expenseName, setExpenseName] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDate(new Date().toISOString().split('T')[0]);
  }, []);

  // Logic: 
  // User selects an existing expense name OR types a new one?
  // Legacy allows typing name. If matches existing, reuse? 
  // Legacy `NewExpense.js` creates NEW `expenses` doc every time? 
  // Checking legacy code: `firestore().collection('expenses').add(...)` -> THEN `expenseDetails`.
  // So it creates a NEW expense definition for EVERY entry? That seems redundant if reusing names, but let's check legacy again.
  // Legacy `SaveContent`: adds to `expenses` THEN `expenseDetails`. 
  // Yes, it duplicates. "name", "lcase", "img", "category" in `expenses`.
  // And `expenseId` in `expenseDetails` links to that SPECIFIC new doc.
  // So effectively `expenses` collection is just metadata for each detail line item? Or is it master data?
  // `NewExpense.js` line 120 adds to `expenses`.
  // So yes, it creates a new "Expense Definition" for every transaction? That's weird database design but I MUST FOLLOW IT to match legacy.
  // WAIT. `122: name: expenseName, 125: category: currentCategory`.
  // It seems to create a new `expenses` doc for every transaction.
  // I will follow this pattern to be safe.

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseName || !amount || !selectedCategory) return;

    setLoading(true);
    try {
      // 1. Add to expenses collection
      const expenseDoc = await addDoc(collection(db, 'expenses'), {
        name: expenseName,
        lcase: expenseName.toLowerCase(),
        img: "https://img.icons8.com/plasticine/100/000000/image.png", // Default image for now
        category: selectedCategory
      });

      // 2. Add to expenseDetails collection
      await addDoc(collection(db, 'expenseDetails'), {
        expenseId: expenseDoc.id,
        amount: parseInt(amount),
        notes: notes,
        addedDate: Timestamp.fromDate(new Date(date)),
        category: selectedCategory, // Redundant but legacy might use it
        bill: [],
        fav: false
      });

      onClose();
      // Reset form
      setExpenseName('');
      setAmount('');
      setNotes('');
    } catch (error) {
      console.error("Error adding expense", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-100">
        <div className="bg-white p-4 flex justify-between items-center border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Add Expense</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Expense Name</label>
            <input
              type="text"
              value={expenseName}
              onChange={(e) => setExpenseName(e.target.value)}
              className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
              placeholder="e.g. Lunch with team"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-3.5 text-gray-400 font-medium">Rs.</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 pl-10 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Category</label>
              <div className="relative">
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all appearance-none"
                  required
                >
                  <option value="">Select</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-3.5 pointer-events-none text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all resize-none"
              placeholder="Optional details..."
              rows={2}
            />
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-gray-900 text-white rounded-xl font-medium hover:bg-black transition-all shadow-lg shadow-gray-200 flex justify-center items-center gap-2"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : 'Save Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
