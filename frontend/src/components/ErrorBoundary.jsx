import { Component } from 'react';
import Button from './Button';
import EmptyState from './EmptyState';
import './primitives.css';

// The error detail goes to the console only: a raw error.message is English,
// technical and may name internals, so the page shows a fixed message.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="pw-error-boundary">
          <EmptyState
            tone="error"
            title="Terjadi kesalahan"
            description="Halaman ini gagal ditampilkan. Muat ulang halaman, atau hubungi tim IT bila terus terjadi."
            action={(
              <Button
                onClick={() => {
                  this.setState({ error: null });
                  location.reload();
                }}
              >
                Muat ulang
              </Button>
            )}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
