import { Component } from 'react';
import Button from './Button';

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
        <div style={{ padding: 40, maxWidth: 640, margin: '40px auto' }}>
          <h2>Terjadi kesalahan</h2>
          <pre
            style={{
              background: '#fef2f2',
              color: '#991b1b',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              overflowX: 'auto',
            }}
          >
            {this.state.error.message}
          </pre>
          <Button
            onClick={() => {
              this.setState({ error: null });
              location.reload();
            }}
          >
            Muat Ulang
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

