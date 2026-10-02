import Button from '../../../components/Button';
import { useAuth } from '../../../context/AuthContext';
import { allowedLink } from '../managementFlowModel';

// A text link on a flow card, only to a page the user may open (allowedLink):
// the Management Office has no Data Sales, and a page the user cannot open
// sends them home. Otherwise null — the card keeps its numbers, without a link.
export default function useLinkAction() {
  const { user } = useAuth();
  return (to, label) => {
    const href = allowedLink(to, user?.permissions);
    return href ? <Button variant="text" to={href}>{label}</Button> : null;
  };
}
