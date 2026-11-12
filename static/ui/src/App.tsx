import React, { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import { Container, TextField, Button, Box, Typography } from '@mui/material';
import { AccessCodeRequest, verifyAccessCode, fetchMicrocycle } from './api';
import ScheduleView from './pages/ScheduleView';

// Context to share the access code throughout the app
export const AccessCodeContext = React.createContext<string>('');

const App: React.FC = () => {
  const [code, setCode] = useState('');
  const [valid, setValid] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    try {
      await verifyAccessCode(code);
      setValid(true);
      setError('');
    } catch (e: any) {
      setError(e.message || 'Código inválido');
    }
  };

  return (
    <AccessCodeContext.Provider value={code}>
      <Router>
        <Container maxWidth="md" sx={{ mt: 4 }}>
          {valid ? (
            <Routes>
              <Route path="/" element={<ScheduleView />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          ) : (
            <Box display="flex" flexDirection="column" alignItems="center" gap={2}>
              <Typography variant="h5">Introduce el código de acceso</Typography>
              <TextField
                label="Código"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
                sx={{ width: '300px' }}
              />
              <Button variant="contained" onClick={handleSubmit}>Acceder</Button>
              {error && <Typography color="error">{error}</Typography>}
            </Box>
          )}
        </Container>
      </Router>
    </AccessCodeContext.Provider>
  );
};

export default App;
