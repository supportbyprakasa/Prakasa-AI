// Ref helper for the selection controls: the component keeps its own ref to
// the native input (indeterminate) and still forwards the caller's ref.
export function mergeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => {
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    });
  };
}
