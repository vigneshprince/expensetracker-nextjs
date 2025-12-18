'use client';

import { useState, useEffect, useRef } from 'react';
import { collection, addDoc, Timestamp, doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { searchImagesAction } from '@/app/actions/searchImages';
import { X, Loader2, Camera, Upload, Paperclip, FileText, ChevronDown, Search } from 'lucide-react';
import Image from 'next/image';

interface Category {
  id: string;
  name: string;
}

interface ExpenseMain {
  id: string;
  name: string;
  category: string;
  img: string;
  lcase?: string; // Add lcase if needed for stricter matching, but simple includes is fine
}

interface ExpenseDetail {
  id: string;
  expenseId: string;
  amount: number;
  addedDate: Timestamp;
  notes: string;
  category?: string;
  expenseName?: string; // Optional for UI
  img?: string; // Optional for UI
  bill?: string[]; // Legacy supports multiple, we'll support at least one for now
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  expenseDefs: ExpenseMain[];
  editingExpense?: ExpenseDetail | null;
  initialData?: any; // From Voice
}

const getFileNameFromUrl = (url: string) => {
  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split('/');
    const lastPart = parts[parts.length - 1];
    // Remove query params if any
    const fileNameWithParams = lastPart.split('?')[0];
    // Remove timestamp prefix if present (e.g., 1734505051234_filename.pdf)
    const fileName = fileNameWithParams.includes('_') ? fileNameWithParams.split('_').slice(1).join('_') : fileNameWithParams;
    return fileName || 'Unknown File';
  } catch (e) {
    return 'Unknown File';
  }
};

export default function AddExpenseModal({ isOpen, onClose, categories, expenseDefs, editingExpense, initialData }: Props) {
  const [expenseName, setExpenseName] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);

  // Computed suggestions
  const categorySuggestions = categories.filter(c =>
    c.name.toLowerCase().includes(categorySearch.toLowerCase())
  );

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedBillFiles, setSelectedBillFiles] = useState<File[]>([]);
  const [existingBills, setExistingBills] = useState<string[]>([]); // URLs of existing bills
  const [previewUrl, setPreviewUrl] = useState('');

  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<ExpenseMain[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const billInputRef = useRef<HTMLInputElement>(null);

  // Image Search State
  const [showImageSearch, setShowImageSearch] = useState(false);
  const [imageSearchQuery, setImageSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const handleImageSearch = async (overrideQuery?: string) => {
    const query = overrideQuery || imageSearchQuery;
    if (!query) return;
    setSearchLoading(true);
    try {
      const results = await searchImagesAction(query);
      setSearchResults(results);
    } catch (e) {
      console.error(e);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleImageSelect = async (url: string) => {
    try {
      setLoading(true); // Show global loading while fetching blob
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], "google_image_search.jpg", { type: blob.type });
      setSelectedFile(file);
      setPreviewUrl(url); // Or use URL.createObjectURL(file) 
      setShowImageSearch(false);
    } catch (e) {
      console.error("Failed to download image", e);
      alert("Failed to load this image. Please try another.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (editingExpense) {
      setExpenseName(editingExpense.expenseName || '');
      setAmount(editingExpense.amount.toString());
      setNotes(editingExpense.notes || '');
      if (editingExpense.addedDate) {
        setDate(new Date(editingExpense.addedDate.toDate()).toISOString().split('T')[0]);
      }
      const foundCat = editingExpense.category ? categories.find(c => c.id === editingExpense.category) : null;
      setSelectedCategoryId(editingExpense.category || '');
      setCategorySearch(foundCat ? foundCat.name : '');

      setPreviewUrl(editingExpense.img || '');
      if (editingExpense.bill && editingExpense.bill.length > 0) {
        setExistingBills(editingExpense.bill);
      } else {
        setExistingBills([]);
      }
      setShowCategorySuggestions(false);
    } else if (initialData) {
      // Voice Fill
      setExpenseName(initialData.expenseName || '');
      setAmount(initialData.amount ? initialData.amount.toString() : '');
      setNotes(initialData.notes || '');
      // Handle Date (YYYY-MM-DD or partial)
      if (initialData.date) {
        setDate(initialData.date);
      } else {
        setDate(new Date().toISOString().split('T')[0]);
      }

      // Handle Category
      const catName = initialData.category || '';
      const foundCat = categories.find(c => c.name.toLowerCase() === catName.toLowerCase());

      if (foundCat) {
        setSelectedCategoryId(foundCat.id);
        setCategorySearch(foundCat.name);
      } else {
        setSelectedCategoryId('');
        setCategorySearch(catName);
      }
      setShowCategorySuggestions(false);

      setPreviewUrl('');
      setSelectedFile(null);
      setSelectedBillFiles([]);
      setExistingBills([]);
    } else {
      // Reset or Default
      setExpenseName('');
      setAmount('');
      setNotes('');
      setDate(new Date().toISOString().split('T')[0]);
      setSelectedCategoryId('');
      setCategorySearch('');
      setPreviewUrl('');
      setSelectedFile(null);
      setSelectedBillFiles([]);
      setExistingBills([]);
      setShowCategorySuggestions(false);
    }
  }, [editingExpense, initialData, isOpen, categories]);

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleBillSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setSelectedBillFiles(prev => [...prev, ...files]);
      // Reset input so same files can be selected again if needed (though duplicated in list, user can remove)
      if (billInputRef.current) billInputRef.current.value = '';
    }
  };

  const removeNewBill = (index: number) => {
    setSelectedBillFiles(prev => prev.filter((_, i) => i !== index));
  };

  const removeExistingBill = (index: number) => {
    setExistingBills(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseName || !amount) return;
    if (!expenseName || !amount) return;
    if (!categorySearch) return; // Must have some category text

    setLoading(true);
    try {
      // 0. Handle Category
      let finalCategoryId = selectedCategoryId;

      // If no ID but we have text, and that text doesn't exactly match an existing category by name (double check)
      if (!finalCategoryId && categorySearch) {
        // Double check exact match to be safe
        const existing = categories.find(c => c.name.toLowerCase() === categorySearch.toLowerCase());
        if (existing) {
          finalCategoryId = existing.id;
        } else {
          // Create New Category
          const catDoc = await addDoc(collection(db, 'categories'), {
            name: categorySearch.charAt(0).toUpperCase() + categorySearch.slice(1), // Capitalize
            img: 'https://img.icons8.com/color/48/000000/ingredients-list.png',
          });
          finalCategoryId = catDoc.id;
        }
      }
      let imageUrl = previewUrl; // Use existing if no new file
      // If no preview and default was needed
      if (!imageUrl && !editingExpense) {
        imageUrl = "https://img.icons8.com/plasticine/100/000000/image.png";
      }

      // Upload Image if selected
      if (selectedFile) {
        const storageRef = ref(storage, `expenses/${Date.now()}_${selectedFile.name}`);
        const snapshot = await uploadBytes(storageRef, selectedFile);
        imageUrl = await getDownloadURL(snapshot.ref);
      }

      // Upload Bills if selected
      // Combined bills = Remaining Existing Bills + Newly Uploaded Bills
      let billUrls: string[] = [...existingBills];

      if (selectedBillFiles.length > 0) {
        const uploadPromises = selectedBillFiles.map(async (file) => {
          const billRef = ref(storage, `bills/${Date.now()}_${file.name}`);
          const snapshot = await uploadBytes(billRef, file);
          return await getDownloadURL(snapshot.ref);
        });
        const newUrls = await Promise.all(uploadPromises);
        billUrls = [...billUrls, ...newUrls];
      }

      // 1. Check if name changed or new, update/create definition
      // Ideally we find existing definition if checking properly, but following "create new definition" pattern for now or just updating detail
      // If editing, we update the DETAIL. Do we update the DEFINITION?
      // Legacy EditExpense updates `expenseDetails`. It does NOT update `expenses` collection generally unless name changed?
      // Legacy EditExpense only updates: amount, notes, bill, addedDate. It does NOT seem to update Name or Category or Image in the `expenses` collection?
      // Wait, legacy `EditExpense.js` allows editing Amount, Notes, Date, Image.
      // It does NOT seem to allow editing Name? 
      // `TextInput disabled={loader} label="Amount"...`
      // There is NO name input in `EditExpense.js`. See line 133 in legacy `EditExpense.js`.
      // BUT `Dashboard.tsx` uses `expenseName` from `expenseDefs`.
      // If I want to allow editing Name, I should probably update `expenses` doc too.
      // For now, I will allow updating everything.

      let currentExpenseId = editingExpense?.expenseId;

      if (!editingExpense || (editingExpense && expenseName !== editingExpense.expenseName)) {
        // If name changed or new, maybe create new definition? 
        // Or just update existing one if we want to rename?
        // Let's create new definition if new, or update if existing using `set`? 
        // Simpler: Just create new definition if it's a new name or new expense. 
        // Actually, if editing, we might want to keep the same ID but update name?
        // Let's just create a new entry in `expenses` if it doesn't exist?
        // To be safe and consistent with "Add", let's create a new `expenses` doc if it is a NEW expense. 
        // If EDITING, let's update the existing `expenses` doc if we have the ID?
        // `editingExpense.expenseId` holds the ID of the definition.

        if (currentExpenseId) {
          // Update existing definition
          await updateDoc(doc(db, 'expenses', currentExpenseId), {
            name: expenseName,
            lcase: expenseName.toLowerCase(),
            img: imageUrl,
            category: finalCategoryId
          });
        } else {
          // Create new (should be covered by Add path, but just in case)
          const expenseDoc = await addDoc(collection(db, 'expenses'), {
            name: expenseName,
            lcase: expenseName.toLowerCase(),
            img: imageUrl,
            category: finalCategoryId
          });
          currentExpenseId = expenseDoc.id;
        }
      }

      if (editingExpense) {
        // Update existing detail
        await updateDoc(doc(db, 'expenseDetails', editingExpense.id), {
          amount: parseInt(amount),
          notes: notes,
          addedDate: Timestamp.fromDate(new Date(date)),
          category: finalCategoryId,
          bill: billUrls,
          // expenseId: currentExpenseId // If point to new definition
        });
        // Update definition if we didn't above? We did above.
      } else {
        // Add new
        // 1. Add to expenses collection (if not done in logic above? Wait, logic above was for editing)
        // If NEW:
        const expenseDoc = await addDoc(collection(db, 'expenses'), {
          name: expenseName,
          lcase: expenseName.toLowerCase(),
          img: imageUrl,
          category: finalCategoryId
        });
        currentExpenseId = expenseDoc.id;

        // 2. Add to expenseDetails collection
        await addDoc(collection(db, 'expenseDetails'), {
          expenseId: currentExpenseId,
          amount: parseInt(amount),
          notes: notes,
          addedDate: Timestamp.fromDate(new Date(date)),
          category: finalCategoryId,
          bill: billUrls,
          fav: false
        });
      }

      onClose();
      // Reset form
      setExpenseName('');
      setAmount('');
      setNotes('');
      setSelectedFile(null);
      setSelectedBillFiles([]);
      setExistingBills([]);
      setPreviewUrl('');
    } catch (error) {
      console.error("Error adding/updating expense", error);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-100">
        <div className="bg-white p-4 flex justify-between items-center border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{editingExpense ? 'Edit Expense' : 'Add Expense'}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        {/* Image Search Modal */}
        {showImageSearch && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl p-6 h-[80vh] flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Search Google Images</h3>
                <button
                  type="button"
                  onClick={() => setShowImageSearch(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={imageSearchQuery}
                  onChange={(e) => setImageSearchQuery(e.target.value)}
                  className="flex-1 bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 outline-none"
                  placeholder="Search for images..."
                  onKeyDown={(e) => e.key === 'Enter' && handleImageSearch()}
                />
                <button
                  type="button"
                  onClick={() => handleImageSearch()}
                  disabled={searchLoading}
                  className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-black disabled:bg-gray-400 font-medium"
                >
                  {searchLoading ? <Loader2 className="animate-spin" size={20} /> : 'Search'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3 p-1">
                {searchResults.map((url, index) => (
                  <div
                    key={index}
                    onClick={() => handleImageSelect(url)}
                    className="relative aspect-square rounded-lg overflow-hidden border border-gray-100 cursor-pointer hover:ring-2 hover:ring-blue-500 group bg-gray-50"
                  >
                    {/* Use normal img tag for external results to avoid Next.js domain config issues for random search results */}
                    <img
                      src={url}
                      alt={`Result ${index}`}
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                  </div>
                ))}
                {!searchLoading && searchResults.length === 0 && (
                  <div className="col-span-full text-center text-gray-400 py-10">
                    {imageSearchQuery ? 'No images found.' : 'Enter a query to search.'}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Form Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="flex flex-col items-center justify-center mb-6">
            <div className="flex items-end gap-2">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="relative w-24 h-24 rounded-full bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden group"
              >
                {previewUrl ? (
                  <Image src={previewUrl} alt="Preview" fill className="object-cover" />
                ) : (
                  <Camera className="text-gray-400 group-hover:text-gray-600" size={32} />
                )}
                <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Upload className="text-white" size={24} />
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setImageSearchQuery(expenseName || categorySearch || '');
                  setShowImageSearch(true);
                  if (expenseName) handleImageSearch(expenseName);
                }}
                className="mb-1 p-2 bg-blue-50 text-blue-600 rounded-full hover:bg-blue-100 border border-blue-200 transition-colors"
                title="Search from Web"
              >
                <Search size={16} />
              </button>
            </div>

            <span className="text-xs text-gray-500 mt-2 font-medium">{editingExpense ? 'Change Photo' : 'Add Photo'}</span>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              accept="image/*"
              className="hidden"
            />
          </div>

          <div className="relative">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Expense Name</label>
            <input
              type="text"
              value={expenseName}
              onChange={(e) => {
                const val = e.target.value;
                setExpenseName(val);
                if (val.length > 0) {
                  const lower = val.toLowerCase();
                  const matches = expenseDefs.filter(d =>
                    d.name.toLowerCase().includes(lower) &&
                    d.name.toLowerCase() !== lower // Don't show if exact match already? Or show anyway?
                  );
                  setSuggestions(matches);
                  setShowSuggestions(true);
                } else {
                  setSuggestions([]);
                  setShowSuggestions(false);
                }
              }}
              onFocus={() => {
                if (expenseName) setShowSuggestions(true);
              }}
              // onBlur={() => setTimeout(() => setShowSuggestions(false), 200)} // Delay to allow click
              className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
              placeholder="e.g. Lunch with team"
              required
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 w-full bg-white mt-1 border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {suggestions.map((s) => (
                  <div
                    key={s.id}
                    className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 flex items-center justify-between"
                    onClick={() => {
                      setExpenseName(s.name);
                      if (s.category) {
                        setSelectedCategoryId(s.category);
                        const catName = categories.find(c => c.id === s.category)?.name;
                        if (catName) setCategorySearch(catName);
                      }
                      if (s.img) setPreviewUrl(s.img);
                      setSuggestions([]);
                      setShowSuggestions(false);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {s.img && (
                        <div className="relative w-6 h-6 rounded-full overflow-hidden bg-gray-100">
                          <Image src={s.img} alt="" fill className="object-cover" />
                        </div>
                      )}
                      <span className="text-gray-900">{s.name}</span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {categories.find(c => c.id === s.category)?.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
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
            <div className="relative">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Category</label>
              <div className="relative">
                <input
                  type="text"
                  value={categorySearch}
                  onChange={(e) => {
                    setCategorySearch(e.target.value);
                    setSelectedCategoryId(''); // clear exact match ID when typing
                    setShowCategorySuggestions(true);
                  }}
                  onFocus={() => setShowCategorySuggestions(true)}
                  className="w-full bg-gray-50 border-gray-200 rounded-lg p-3 text-gray-900 focus:ring-2 focus:ring-gray-900 focus:border-transparent outline-none transition-all"
                  placeholder="Select or Type New Category"
                  required
                />
                <div className="absolute right-3 top-3.5 pointer-events-none text-gray-400">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>

              {showCategorySuggestions && (
                <div className="absolute z-10 w-full bg-white mt-1 border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {categorySuggestions.map(cat => (
                    <div
                      key={cat.id}
                      className="p-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0 flex items-center justify-between"
                      onClick={() => {
                        setSelectedCategoryId(cat.id);
                        setCategorySearch(cat.name);
                        setShowCategorySuggestions(false);
                      }}
                    >
                      <span className="text-gray-900">{cat.name}</span>
                    </div>
                  ))}
                  {categorySuggestions.length === 0 && (
                    <div className="p-3 text-sm text-gray-500 bg-gray-50 italic">
                      Press Save to create "{categorySearch}"
                    </div>
                  )}
              </div>
              )}
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

          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Bill / Receipt</label>
            <div
              onClick={() => billInputRef.current?.click()}
              className="w-full bg-gray-50 border border-dashed border-gray-300 rounded-lg p-4 flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-100 transition-colors"
            >
              <Paperclip className="text-gray-400" size={20} />
              <span className="text-sm text-gray-600 font-medium">
                Add Bills
              </span>
              <input
                type="file"
                ref={billInputRef}
                onChange={handleBillSelect}
                className="hidden"
                multiple
              />
            </div>



            {/* Bill List */}
            {((existingBills.length > 0) || (selectedBillFiles.length > 0)) && (
              <div className="mt-3 space-y-2">
                {/* Existing Bills */}
                {existingBills.map((url, index) => (
                  <div key={`existing-${index}`} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText size={16} className="text-blue-500 shrink-0" />
                      <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 truncate hover:underline block max-w-[200px]" title={getFileNameFromUrl(url)}>
                        {getFileNameFromUrl(url)}
                      </a>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExistingBill(index)}
                      className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}

                {/* New Files */}
                {selectedBillFiles.map((file, index) => (
                  <div key={`new-${index}`} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText size={16} className="text-green-500 shrink-0" />
                      <span className="text-xs text-gray-700 truncate max-w-[200px]">{file.name}</span>
                      <span className="text-[10px] text-gray-400 bg-gray-100 px-1 rounded">New</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeNewBill(index)}
                      className="text-gray-400 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (editingExpense ? 'Update Expense' : 'Save Expense')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
