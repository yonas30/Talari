import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, TextInputProps } from 'react-native';

import { radius } from '../constants/theme';
import { useThemeColors } from '../theme/ThemeProvider';
import AppTextInput from './AppTextInput';

interface FormInputProps extends TextInputProps {
  /** Draws the edge in the danger tone (the message itself is shown as text next to the field, never by colour alone). */
  invalid?: boolean;
}

// The text field of every form: the screen colour as its fill, a 1 px edge with the 3:1 input-border contrast, a darker edge while
// focused, the orange cursor and selection, and the text and placeholder colours from the theme.
const FormInput = forwardRef<TextInput, FormInputProps>(function FormInput({ style, invalid = false, onFocus, onBlur, ...rest }, ref) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);

  return (
    <AppTextInput
      ref={ref}
      placeholderTextColor={colors.textMuted}
      cursorColor={colors.primary}
      selectionColor={colors.primary}
      {...rest}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[
        styles.input,
        {
          color: colors.text,
          backgroundColor: colors.bg,
          borderColor: invalid ? colors.expense : focused ? colors.text : colors.inputBorder,
        },
        style,
      ]}
    />
  );
});

export default FormInput;

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.button,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
});
