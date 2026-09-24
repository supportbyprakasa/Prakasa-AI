import { Link } from 'react-router-dom';
import { ChevronRight, Sparkles, Sun } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotificationCount } from '../context/NotificationContext';
import { useNavConfig } from '../components/Sidebar';
import { hubCards } from '../components/navigation';
import BrandDoodles from '../components/BrandDoodles';

export default function Dashboard() {
  const { user } = useAuth();
  const { unreadCount } = useNotificationCount();
  const sections = useNavConfig();
  const hour = new Date().getHours();
  const salutation = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam';
  const firstName = (user?.name || user?.email?.split('@')[0] || 'Rekan').split(' ')[0];
  const briefVisible = sections.some((section) => section.items.some((item) => item.to === '/brief'));

  return <div className="hub-home fade-in">
    <div className="hub-greeting"><BrandDoodles /><span className="hub-greeting__icon"><Sun size={24} strokeWidth={1.6} /></span><div><h1>{salutation}, {firstName}</h1><p>Pilih modul untuk mulai kerja.</p></div></div>
    {briefVisible && <Link className="hub-brief" to="/brief"><span className="hub-brief__icon"><Sparkles size={18} /></span><span className="hub-brief__copy"><strong>AI Brief Hari Ini</strong><small>Ringkasan pekerjaan dan aktivitas terbaru Anda · {unreadCount} notifikasi belum dibaca.</small></span><span className="hub-brief__action">Lihat Brief</span></Link>}
    <div className="hub-divisions">{hubCards(sections).map((card) => {
      const Icon = card.icon;
      return <Link key={card.slug} to={card.to} className="hub-division-card">
        <div className="hub-division-card__top"><span className="hub-icon"><Icon size={22} strokeWidth={1.6} /></span><ChevronRight size={17} /></div>
        <div><h2>{card.title}</h2><p>{card.description}</p></div>
        <span className="hub-count">{card.count} modul</span>
      </Link>;
    })}</div>
  </div>;
}
