import * as ImagePicker from 'expo-image-picker';
import TextRecognition from '@react-native-ml-kit/text-recognition';

/** Longest text taken from one image, so a long page does not crowd out the chat history. */
export const MAX_IMAGE_TEXT_CHARS = 1200;

/** Lets the user choose a photo. Resolves to the picked image's URI, or null when they cancel. */
export async function pickImage(): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || result.assets.length === 0) return null;
  return result.assets[0].uri;
}

/** Reads the text in an image on the phone. Resolves to an empty string when the image has no text. */
export async function readImageText(uri: string): Promise<string> {
  const result = await TextRecognition.recognize(uri);
  return result.text.trim().slice(0, MAX_IMAGE_TEXT_CHARS);
}

/** The text the model receives: the text read from the image, then the user's question about it. */
export function composeImagePrompt(imageText: string, question: string): string {
  return (
    'The user attached an image. Text read from the image:\n"""\n' +
    imageText +
    '\n"""\n\nAnswer the question using that text.\n\nQuestion: ' +
    question
  );
}
