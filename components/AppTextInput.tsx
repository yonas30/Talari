import { forwardRef } from 'react';
import { TextInput, TextInputProps } from 'react-native';

import { resolveTextStyle } from '../theme/textStyle';
import { useThemeColors } from '../theme/ThemeProvider';

// React Native's TextInput with the same font handling as AppText (amount field, forms, search).
const AppTextInput = forwardRef<TextInput, TextInputProps>(function AppTextInput({ style, ...rest }, ref) {
  const colors = useThemeColors();
  return <TextInput ref={ref} {...rest} style={resolveTextStyle(style, undefined, colors)} />;
});

export default AppTextInput;
