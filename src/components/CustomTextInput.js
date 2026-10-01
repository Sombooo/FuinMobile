import React from 'react';
import { TextInput as RNTextInput, StyleSheet } from 'react-native';

export default function CustomTextInput(props) {
  const flattenedStyle = StyleSheet.flatten(props.style) || {};
  let fontFamily = 'JetBrains Mono';
  const weight = flattenedStyle.fontWeight;
  
  if (weight) {
    if (weight === 'bold' || weight === '700' || weight === '800' || weight === '900') {
      fontFamily = 'JetBrains Mono-Bold';
    } else if (weight === '600') {
      fontFamily = 'JetBrains Mono-SemiBold';
    } else if (weight === '500') {
      fontFamily = 'JetBrains Mono-Medium';
    }
  }

  const newStyle = { ...flattenedStyle, fontFamily, fontWeight: undefined };

  return <RNTextInput {...props} style={newStyle} />;
}
