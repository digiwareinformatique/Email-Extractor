import React from 'react';
import { ExtensionSyncModal } from './ExtensionSyncModal';

interface ExtensionSyncPanelProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFile?: string;
}

export const ExtensionSyncPanel: React.FC<ExtensionSyncPanelProps> = ({
  isOpen,
  onClose,
  defaultFile
}) => {
  return (
    <ExtensionSyncModal
      isOpen={isOpen}
      onClose={onClose}
      defaultFile={defaultFile}
    />
  );
};
export default ExtensionSyncPanel;
