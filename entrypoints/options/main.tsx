import React from 'react';
import ReactDOM from 'react-dom/client';
import { OptionsApp } from './OptionsApp';
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '../sidepanel/style.css';
import './options.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);
