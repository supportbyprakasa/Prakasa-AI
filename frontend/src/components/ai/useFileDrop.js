import { useRef, useState } from 'react';
import { dragCarriesFiles, filesFromDrop, namePastedFile } from './aiFiles';

const carriesFiles = (event) => dragCarriesFiles(event.dataTransfer);

// Drag-and-drop of files onto a whole area. Returns the props to spread on the drop target
// and whether files are currently dragged over it (to show an overlay).
export default function useFileDrop(onFiles, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  if (!enabled) return { dragging: false, dropProps: {} };

  const dropProps = {
    onDragEnter: (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (event) => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = filesFromDrop(event.dataTransfer);
      if (files.length) onFiles(files);
    },
  };

  return { dragging, dropProps };
}

// Kept here for its callers; the function lives with the other file helpers.
export { namePastedFile };
