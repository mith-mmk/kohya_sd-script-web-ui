import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { LangProvider } from './i18n/LangContext.js';
import { ThemeProvider } from './theme.js';
import './theme.css';

const el = document.getElementById('root')!;
createRoot(el).render(
  <React.StrictMode>
    <ThemeProvider>
      <LangProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </LangProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
