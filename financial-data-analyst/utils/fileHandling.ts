// utils/fileHandling.ts
export const readFileAsText = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const result = reader.result;
        if (typeof result === "string" && result.length > 0) {
          resolve(result);
        } else {
          reject(new Error("Empty or invalid text file"));
        }
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
};

export const readFileAsBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const base64 = (reader.result as string).split(",")[1];
        resolve(base64);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export const readFileAsPDFText = async (file: File): Promise<string> => {
  // Dynamic import keeps pdfjs (which touches browser globals) out of SSR.
  const pdfjsLib = await import("pdfjs-dist");
  if (!pdfjsLib.GlobalWorkerOptions.workerPort) {
    // `new Worker(new URL(...))` lets the bundler ship the worker as a
    // same-origin chunk, so nothing is fetched from a third-party CDN.
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(
      new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
      { type: "module" },
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    isEvalSupported: false,
  }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    let lastY: number | null = null;
    let text = "";

    for (const item of textContent.items) {
      if (!("str" in item)) continue; // TextMarkedContent has no text
      if (lastY !== null && Math.abs(lastY - item.transform[5]) > 5) {
        text += "\n";
      } else if (lastY !== null && text.length > 0) {
        text += " ";
      }

      text += item.str;
      lastY = item.transform[5];
    }

    fullText += text + "\n\n";
  }

  return fullText.trim();
};

// Update the type definition
export interface FileUpload {
  base64: string;
  fileName: string;
  mediaType: string;
  isText?: boolean;
  fileSize?: number; // Optional: Add file size information
}
