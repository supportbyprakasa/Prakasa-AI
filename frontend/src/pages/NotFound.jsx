import { useLocation } from 'react-router-dom';
import Button from '../components/Button';
import EmptyState from '../components/EmptyState';
import Page from '../components/Page';

// Unknown address inside the app shell (App.jsx `*` route): say so instead of
// silently sending the user home, and offer the way back to Beranda.
export default function NotFound() {
  const { pathname } = useLocation();
  return (
    <Page title="Halaman tidak ditemukan">
      <EmptyState
        icon="travel_explore"
        title="Alamat ini tidak ada di Prakasa Workspace"
        description={`Periksa kembali tautan ${pathname}, atau buka halaman lain dari menu samping.`}
        action={<Button to="/" icon="home">Kembali ke Beranda</Button>}
      />
    </Page>
  );
}
