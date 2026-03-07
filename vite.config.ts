import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { GoogleGenAI, Type } from '@google/genai';

// Mock Netlify function for local development in AI Studio
const netlifyMockPlugin = (env: Record<string, string>) => ({
  name: 'netlify-mock',
  configureServer(server: any) {
    server.middlewares.use('/.netlify/functions/gemini', async (req: any, res: any) => {
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk: any) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { base64Data } = JSON.parse(body);
            const apiKey = env.GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: "GEMINI_API_KEY is not set locally." }));
              return;
            }
            
            const ai = new GoogleGenAI({ apiKey });
            const response = await ai.models.generateContent({
              model: 'gemini-3-flash-preview',
              contents: [
                { inlineData: { data: base64Data, mimeType: 'application/pdf' } }, 
                "Extrae todas las transacciones de este extracto bancario. Devuelve un arreglo JSON de objetos. Cada objeto debe tener: 'fecha' (DD/MM/YYYY), 'descripcion' (texto descriptivo), 'referencia' (número de documento o referencia si existe, si no vacío), 'tipo' (debe ser 'INGRESO' o 'EGRESO'), 'valor' (número positivo)."
              ],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: { 
                    type: Type.OBJECT, 
                    properties: { 
                      fecha: { type: Type.STRING }, 
                      descripcion: { type: Type.STRING }, 
                      referencia: { type: Type.STRING }, 
                      tipo: { type: Type.STRING }, 
                      valor: { type: Type.NUMBER } 
                    } 
                  }
                }
              }
            });
            
            res.setHeader('Content-Type', 'application/json');
            res.end(response.text || "[]");
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      }
    });
  }
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss(), netlifyMockPlugin(env)],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
