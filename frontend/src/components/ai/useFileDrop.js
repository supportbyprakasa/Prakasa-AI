import { useRef, useState } from 'react';

const carriesFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files');

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
      const files = Array.from(event.dataTransfer.files || []);
      if (files.length) onFiles(files);
    },
  };

  return { dragging, dropProps };
}

// Screenshots pasted from the clipboard are all called "image.png"; give them a unique name.
export function namePastedFile(file) {
  if (file.name && file.name !== 'image.png') return file;
  const extension = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new File([file], `tempelan-${stamp}.${extension}`, { type: file.type });
}
