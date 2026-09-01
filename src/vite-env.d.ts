/// <reference types="vite/client" />

// Sample templates are bundled as raw text rather than parsed by Vite.
declare module '*.yaml?raw' {
  const content: string;
  export default content;
}

declare module '*.tf?raw' {
  const content: string;
  export default content;
}

declare module '*.ts?raw' {
  const content: string;
  export default content;
}
