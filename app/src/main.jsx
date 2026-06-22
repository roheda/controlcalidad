import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import FeedbackWidget from './FeedbackWidget.jsx'
import EstimacionesWidget from './EstimacionesWidget.jsx'
import ObrasCfg from './ObrasConfigWidget.jsx'
import MainNavigation from './MainNavigation.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <FeedbackWidget />
    <EstimacionesWidget />
    <ObrasCfg />
    <MainNavigation />
  </StrictMode>,
)
