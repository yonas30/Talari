import { Modal, ModalProps } from 'react-native';

// The one Modal every overlay in the app uses (sheets, pickers, the drawer, menus). It is transparent and
// statusBarTranslucent: the Modal's window then also covers the strip behind the status bar, so the dim reaches the top of the
// screen instead of leaving a bar in the screen colour with unreadable status-bar icons.
export default function OverlayModal(props: ModalProps) {
  return <Modal transparent statusBarTranslucent {...props} />;
}
