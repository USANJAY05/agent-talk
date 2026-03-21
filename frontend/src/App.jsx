import React, { createContext, useMemo, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import getAppTheme from './theme';
import Home from './pages/Home';
import Auth from './pages/Auth';

export const ThemeModeContext = createContext();

export default function App() {
  const [themeMode, setThemeMode] = useState(localStorage.getItem('agentTalkTheme') || 'dark');
  const theme = useMemo(() => getAppTheme(themeMode), [themeMode]);

  return (
    <ThemeModeContext.Provider value={{ themeMode, setThemeMode }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Auth />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
}
