'use client';

import { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';
import { parseExpenseAction } from '@/app/actions/parseExpense';

interface VoiceInputProps {
  onExpenseParsed: (data: any) => void;
  existingCategories: string[];
  existingExpenses: { name: string; category: string }[];
}

export default function VoiceInput({ onExpenseParsed, existingCategories, existingExpenses }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [recognition, setRecognition] = useState<any>(null);

  // Use refs to avoid stale closures in SpeechRecognition callbacks
  const categoriesRef = useRef(existingCategories);
  const expensesRef = useRef(existingExpenses);

  useEffect(() => {
    categoriesRef.current = existingCategories;
    expensesRef.current = existingExpenses;
  }, [existingCategories, existingExpenses]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognitionInstance = new SpeechRecognition();
        recognitionInstance.continuous = false;
        recognitionInstance.interimResults = false;
        recognitionInstance.lang = 'en-US';

        recognitionInstance.onstart = () => {
          setIsListening(true);
        };

        recognitionInstance.onend = () => {
          setIsListening(false);
        };

        recognitionInstance.onresult = async (event: any) => {
          const text = event.results[0][0].transcript;
          setTranscript(text);
          await handleProcess(text);
        };

        recognitionInstance.onerror = (event: any) => {
          console.error("Speech Recognition Error:", event.error);
          setIsListening(false);
          setIsProcessing(false);
          if (event.error === 'not-allowed') {
            alert("Microphone access blocked. Please allow permissions.");
          }
        };

        setRecognition(recognitionInstance);
      }
    }
  }, []); // eslint-disable-line

  const handleProcess = async (text: string) => {
    if (!text) return;
    setIsProcessing(true);
    try {
      // Create context from expenseDefs
      // Limit to top 50 unique name-category pairs to save tokens/complexity
      const context = expensesRef.current
        .slice(0, 50)
        .map(e => `${e.name}: ${e.category}`)
        .join('\n         ');

      // Use Server Action
      const result = await parseExpenseAction(text, categoriesRef.current, context);

      if (result) {
        onExpenseParsed(result);
      }
    } catch (error) {
      console.error("Error parsing expense:", error);
      alert("Failed to process voice input. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognition?.stop();
    } else {
      setTranscript('');
      recognition?.start();
    }
  };

  if (!recognition) {
    return null; // Hidden if not supported
  }

  return (
    <>
      <button
        onClick={toggleListening}
        disabled={isProcessing}
        className={`
          fixed bottom-24 right-8 p-4 rounded-full shadow-lg transition-all z-20 flex items-center justify-center backdrop-blur-md border border-white/20
          ${isListening ? 'bg-red-500/75 hover:bg-red-600/90 animate-pulse text-white' : 'bg-blue-600/75 hover:bg-blue-700/90 text-white'}
          ${isProcessing ? 'bg-gray-500/75 cursor-wait' : ''}
        `}
        title={isListening ? 'Stop Listening' : 'Voice Add Expense'}
      >
        {isProcessing ? (
          <Loader2 className="animate-spin" size={24} />
        ) : isListening ? (
          <MicOff size={24} />
        ) : (
          <Mic size={24} />
        )}
      </button>

      {/* Voice Overlay */}
      {(isListening || isProcessing) && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm p-6 animate-in fade-in duration-200">
          <div className="flex flex-col items-center gap-8 max-w-2xl w-full text-center">

            {/* Status Indicator */}
            <div className={`
              w-24 h-24 rounded-full flex items-center justify-center
              ${isProcessing ? 'bg-blue-500 animate-pulse' : 'bg-red-500 animate-ping'}
            `}>
              {isProcessing ? (
                <Loader2 className="text-white animate-spin" size={48} />
              ) : (
                <Mic className="text-white" size={48} />
              )}
            </div>

            {/* Status Text */}
            <h2 className="text-2xl font-semibold text-white">
              {isProcessing ? 'Processing Expense...' : 'Listening...'}
            </h2>

            {/* Transcript */}
            <div className="w-full bg-white/10 rounded-2xl p-6 min-h-[150px] flex items-center justify-center border border-white/10">
              <p className="text-xl md:text-2xl font-medium text-white/90 leading-relaxed">
                {transcript || (isListening ? "Say something like 'Lunch for 500'..." : "")}
              </p>
            </div>

            {/* Stop Button (in Overlay) */}
            <button
              onClick={toggleListening}
              className="mt-4 px-8 py-3 bg-white text-gray-900 rounded-full font-semibold hover:bg-gray-100 transition-colors"
            >
              {isProcessing ? 'Please Wait' : 'Stop Listening'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
