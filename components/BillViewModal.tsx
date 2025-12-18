'use client';

import { X, ExternalLink, FileText } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  bills: string[];
}

const getFileNameFromUrl = (url: string) => {
  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split('/');
    const lastPart = parts[parts.length - 1];
    const fileNameWithParams = lastPart.split('?')[0];
    const fileName = fileNameWithParams.includes('_') ? fileNameWithParams.split('_').slice(1).join('_') : fileNameWithParams;
    return fileName || 'Unknown File';
  } catch (e) {
    return 'Bill';
  }
};

export default function BillViewModal({ isOpen, onClose, bills }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200 border border-gray-100">
        <div className="bg-white p-4 flex justify-between items-center border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Attached Bills</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors"
            type="button"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {bills.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No bills attached.</p>
          ) : (
            bills.map((url, index) => (
              <a
                key={index}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors group border border-gray-100"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                    <FileText size={16} />
                  </div>
                  <span className="text-sm font-medium text-gray-900 truncate max-w-[220px]" title={getFileNameFromUrl(url)}>
                    {getFileNameFromUrl(url)}
                  </span>
                </div>
                <ExternalLink size={16} className="text-gray-400 group-hover:text-gray-600" />
              </a>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
