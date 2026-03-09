import { GoogleGenAI, Type } from "@google/genai";

export const handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { base64Data } = JSON.parse(event.body);
    
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { 
        statusCode: 500, 
        body: JSON.stringify({ error: "GEMINI_API_KEY is not set in Netlify environment variables." }) 
      };
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-flash-latest',
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: 'application/pdf'
          }
        },
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

    const text = response.text || "[]";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: text
    };
  } catch (error) {
    console.error("Error in gemini function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to process PDF: " + error.message })
    };
  }
};

export const config = {
  timeout: 15
};
