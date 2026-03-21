import { alpha, createTheme } from '@mui/material';

export default function getAppTheme(mode) {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'dark' ? '#818cf8' : '#4f46e5' },
      secondary: { main: mode === 'dark' ? '#f472b6' : '#db2777' },
      background:
        mode === 'dark'
          ? { default: '#030712', paper: '#0f172a' }
          : { default: '#e2e8f0', paper: '#ffffff' },
      text:
        mode === 'dark'
          ? { primary: '#f8fafc', secondary: '#94a3b8' }
          : { primary: '#0f172a', secondary: '#475569' },
    },
    shape: { borderRadius: 20 },
    typography: {
      fontFamily: 'Outfit, Inter, system-ui, sans-serif',
      h3: { fontWeight: 800, letterSpacing: '-0.04em' },
      h4: { fontWeight: 800, letterSpacing: '-0.03em' },
      h5: { fontWeight: 800, letterSpacing: '-0.02em' },
      button: { textTransform: 'none', fontWeight: 800 },
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: mode === 'dark' ? '0 16px 40px -8px rgba(0,0,0,0.5)' : '0 16px 40px -8px rgba(79,70,229,0.1)',
            border: `1px solid ${mode === 'dark' ? alpha('#ffffff', 0.08) : alpha('#000000', 0.06)}`,
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            boxShadow: 'none',
            '&:hover': {
              boxShadow: mode === 'dark' ? '0 4px 12px rgba(129,140,248,0.3)' : '0 4px 12px rgba(79,70,229,0.3)',
            },
          },
        },
      },
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            '::-webkit-scrollbar': { width: '8px', height: '8px' },
            '::-webkit-scrollbar-track': { background: 'transparent' },
            '::-webkit-scrollbar-thumb': { 
              backgroundColor: mode === 'dark' ? alpha('#ffffff', 0.2) : alpha('#000000', 0.2), 
              borderRadius: '10px' 
            },
            '::-webkit-scrollbar-thumb:hover': { 
              backgroundColor: mode === 'dark' ? alpha('#ffffff', 0.3) : alpha('#000000', 0.3) 
            }
          }
        }
      }
    },
  });
}
