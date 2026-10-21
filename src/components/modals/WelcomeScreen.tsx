import React from 'react';
import { HomeScreen } from '../home/HomeScreen';

interface WelcomeScreenProps {
  onContinueLast: () => void;
  onOpenNew: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onOpenNew }) => {
  return <HomeScreen isOverlay onCloseOverlay={onOpenNew} />;
};
