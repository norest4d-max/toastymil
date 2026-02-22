import { useEffect, useMemo, useState } from 'react';
import './App.css';
import dictionary from './data/dictionary';
import ToastyChat from './components/ToastyChat';
import { loadLearnedTerms, mergeTerms, saveLearnedTerms, upsertLearnedTerm } from './engine/learningStore';

function App() {
  const [learnedTerms, setLearnedTerms] = useState([]);

  useEffect(() => {
    setLearnedTerms(loadLearnedTerms());
  }, []);

  const terms = useMemo(() => mergeTerms(dictionary, learnedTerms), [learnedTerms]);

  function handleLearnTerm(term) {
    const saved = upsertLearnedTerm(term);
    setLearnedTerms((prev) => {
      const next = [...prev];
      const idx = next.findIndex((t) => String(t.word).toLowerCase() === String(saved.word).toLowerCase());
      if (idx >= 0) next[idx] = saved;
      else next.unshift(saved);
      return next;
    });
  }

  function handleClearLearned() {
    saveLearnedTerms([]);
    setLearnedTerms([]);
  }

  return (
    <div className="App">
      <header className="App-header">
        <h1 className="App-title">🍞 ToastyMills</h1>
        <p className="App-subtitle">Local Ollama chat · runs on your device</p>
      </header>

      <main className="App-main">
        <ToastyChat terms={terms} onLearnTerm={handleLearnTerm} onClearLearned={handleClearLearned} />
      </main>
    </div>
  );
}

export default App;
