'use client';

import { format, parseISO, isValid } from 'date-fns';
import { Calendar, CalendarRange } from 'lucide-react';

interface DateFilterProps {
  dateRange: { start: Date; end: Date };
  setDateRange: (range: { start: Date; end: Date } | ((prev: { start: Date; end: Date }) => { start: Date; end: Date })) => void;
  filterMode: 'single' | 'range';
  setFilterMode: (mode: 'single' | 'range') => void;
  hideModeToggle?: boolean;
}

export default function DateFilter({ dateRange, setDateRange, filterMode, setFilterMode, hideModeToggle }: DateFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 justify-center sm:justify-start">
      {!hideModeToggle && (
        <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200">
          <button
            onClick={() => {
              setFilterMode('single');
              // Reset to ensure Start == End for single mode consistency
              // We pass functional update to be safe, though direct object works too if parent handles it
              setDateRange((prev: any) => ({ ...prev, end: prev.start }));
            }}
            className={`p-1.5 rounded-md transition-all ${filterMode === 'single' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            title="Single Month"
          >
            <Calendar size={16} />
          </button>
          <button
            onClick={() => setFilterMode('range')}
            className={`p-1.5 rounded-md transition-all ${filterMode === 'range' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            title="Date Range"
          >
            <CalendarRange size={16} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 sm:gap-2 bg-gray-50 border border-gray-200 rounded-lg p-1">
        {filterMode === 'single' ? (
          <input
            type="month"
            className="bg-transparent text-gray-900 px-1 sm:px-2 py-1 rounded text-xs sm:text-sm font-medium focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
            value={isValid(dateRange.start) ? format(dateRange.start, 'yyyy-MM') : ''}
            onChange={(e) => {
              if (!e.target.value) return;
              const date = parseISO(e.target.value);
              setDateRange({ start: date, end: date });
            }}
            title="Select Month"
          />
        ) : (
          <>
            <input
              type="month"
                className="bg-transparent text-gray-900 px-1 sm:px-2 py-1 rounded text-xs sm:text-sm font-medium focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
              value={isValid(dateRange.start) ? format(dateRange.start, 'yyyy-MM') : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                setDateRange((prev: any) => ({ ...prev, start: parseISO(e.target.value) }));
              }}
              title="From"
            />
            <span className="text-gray-400 text-xs font-medium">to</span>
            <input
              type="month"
                className="bg-transparent text-gray-900 px-1 sm:px-2 py-1 rounded text-xs sm:text-sm font-medium focus:ring-2 focus:ring-gray-900 outline-none cursor-pointer"
              value={isValid(dateRange.end) ? format(dateRange.end, 'yyyy-MM') : ''}
              onChange={(e) => {
                if (!e.target.value) return;
                setDateRange((prev: any) => ({ ...prev, end: parseISO(e.target.value) }));
              }}
              min={isValid(dateRange.start) ? format(dateRange.start, 'yyyy-MM') : undefined}
              title="To"
            />
          </>
        )}
      </div>
    </div>
  );
}
