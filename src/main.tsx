import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { router } from './router.tsx';

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
