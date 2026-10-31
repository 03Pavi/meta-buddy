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

/** Used when the user attaches an image and types no question. */
const DEFAULT_IMAGE_QUESTION = 'Explain what this image shows and what the user should know about it.';

/**
 * The text the model receives. When the image has text, the text is given with the question. When it has
 * none, the model is told so and decides how to reply to what the user wrote.
 */
export function composeImagePrompt(imageText: string, question: string): string {
  const ask = question.trim() || DEFAULT_IMAGE_QUESTION;
  if (!imageText.trim()) {
    return (
      'The user attached an image. Text recognition found no readable text in it, so the image has no text to read. ' +
      'Reply to the user based on this, and say what you can and cannot tell from it.\n\nUser message: ' +
      ask
    );
  }
  return (
    'The user attached an image. Text read from the image:\n"""\n' +
    imageText +
    '\n"""\n\nUse that text to answer the user. Decide what kind of content it is (for example a receipt, a sign, ' +
    'a document, or a message) and reply to match.\n\nUser message: ' +
    ask
  );
}
