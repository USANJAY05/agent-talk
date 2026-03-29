import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/global.css'
import AuthPage from './pages/AuthPage'
import AppPage from './pages/AppPage'
import { useStore } from './store'

function ProtectedRoute({ children }) {
  const token = useStore(s => s.token)
  return token ? children : <Navigate to="/auth" replace />
}

function PublicRoute({ children }) {
  const token = useStore(s => s.token)
  return !token ? children : <Navigate to="/" replace />
}

function ThemeInitializer() {
  const theme = useStore(s => s.theme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])
  return null
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeInitializer />
    <BrowserRouter future={{ v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/auth" element={<PublicRoute><AuthPage /></PublicRoute>} />
        <Route path="/*" element={<ProtectedRoute><AppPage /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
)
