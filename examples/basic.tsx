import { useState } from "react";
import { DiffProvider, File, type FileContents } from "../src";

/** Render inside a GPUiX application with the Pierre extension registered. */
export function BasicEditor() {
  const [file, setFile] = useState<FileContents>({
    name: "hello.ts",
    contents: 'export const greeting = "Hello";\n',
  });
  return (
    <DiffProvider>
      <File
        id="hello-editor"
        file={file}
        edit
        height="100%"
        onEditChange={setFile}
      />
    </DiffProvider>
  );
}
