import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import PageTrail from './PageTrail';
import Footer from './Footer';
import { useNavConfig } from './Sidebar';
import { pageTrail } from './navigation';
import '../styles/layout.css';

export default function Layout() {
  const { pathname } = useLocation();
  const sections = useNavConfig();
  return (
    <div className="prakasa-layout">
      <Navbar />
      <PageTrail trail={pageTrail(pathname, sections)} />
      <main className={`prakasa-layout__main ${pathname === '/' ? 'prakasa-layout__main--home' : ''}`}>
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
