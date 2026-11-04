import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { appConfig } from './config'
import './styles.css'
import './public-ui.css'
import './admin-shell.css'
import './admin-ui.css'
import './admin-secondary.css'

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter basename={appConfig.basePath === '/' ? undefined : appConfig.basePath}><App /></BrowserRouter></StrictMode>)
