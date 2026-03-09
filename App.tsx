import React, { useState, useMemo } from 'react';
import { 
  FileSpreadsheet, AlertTriangle, CheckCircle, 
  Search, Download, RefreshCw, 
  Info, FileText, File as FileIcon, XCircle
} from 'lucide-react';
import * as XLSX from 'xlsx';

// ==================== TYPE DEFINITIONS ====================

interface FileState {
  contable: File | null;
  banco: File | null;
}

interface TransaccionBanco {
  id: string;
  fecha: string;
  descripcion: string;
  referencia: string;
  tipo: 'INGRESO' | 'EGRESO';
  valor: number;
}

interface MovimientoContable {
  id: string;
  fecha: string;
  tercero: string;
  debito: number;
  credito: number;
  cuenta: string;
  netoLinea: number;
}

interface DataState {
  contable: MovimientoContable[];
  banco: TransaccionBanco[];
}

interface ResultItem {
  id: string;
  fechaBanco: string;
  descripcionBanco: string;
  valorBanco: number;
  tipoBanco: string;
  
  fechaContable: string;
  terceroContable: string;
  valorContable: number;
  
  diferencia: number;
  estado: 'CONCILIADO' | 'DIFERENCIA' | 'SOLO_BANCO' | 'SOLO_CONTABLE';
  
  movimientoBanco?: TransaccionBanco;
  movimientoContable?: MovimientoContable;
}

// ==================== CONSTANTES Y UTILIDADES ====================

const excelDateToJSDate = (serial: any) => {
  if (!serial) return null;
  const utc_days  = Math.floor(Number(serial) - 25569);
  const utc_value = utc_days * 86400;                                 
  const date_info = new Date(utc_value * 1000);
  return new Date(date_info.getFullYear(), date_info.getMonth(), date_info.getDate());
}

const formatearFecha = (fecha: any) => {
  if (!fecha) return '-';
  if (typeof fecha === 'number') {
    const d = excelDateToJSDate(fecha);
    if (d) return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const str = String(fecha).trim();
  if (str === '-' || str === '') return '-';
  const matchDMY = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (matchDMY) {
    const day = parseInt(matchDMY[1], 10);
    const month = parseInt(matchDMY[2], 10);
    let year = parseInt(matchDMY[3], 10);
    if (year < 100) year += 2000; 
    const d = new Date(year, month - 1, day);
    if (!isNaN(d.getTime())) {
       return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
  }
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
    }
  } catch (e) {}
  return str;
};

const normalizarValor = (valor: any) => {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  let str = valor.toString().trim().replace(/[$\s]/g, '');
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');
  if (hasDot && hasComma) {
    if (str.lastIndexOf('.') < str.lastIndexOf(',')) {
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      str = str.replace(/,/g, '');
    }
  } else if (hasDot) {
    if ((str.match(/\./g) || []).length > 1) {
       str = str.replace(/\./g, '');
    } else {
       const parts = str.split('.');
       if (parts[1] && parts[1].length === 3) str = str.replace(/\./g, '');
    }
  } else if (hasComma) {
     if ((str.match(/,/g) || []).length > 1) {
       str = str.replace(/,/g, '');
     } else {
       str = str.replace(',', '.');
     }
  }
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

const formatearMoneda = (valor: number) => {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(valor);
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

// ==================== LÓGICA DE NEGOCIO ====================

const extraerDatosBancoPDF = async (file: File): Promise<TransaccionBanco[]> => {
  try {
    const base64 = await fileToBase64(file);
    const base64Data = base64.split(',')[1];
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 seconds timeout

    const response = await fetch('/.netlify/functions/gemini', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ base64Data }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Error del servidor: ${response.status}`);
    }
    
    const text = await response.text();
    const data = JSON.parse(text || "[]");
    
    return data.map((item: any, index: number) => ({
      id: `BANCO-${index}`,
      fecha: formatearFecha(item.fecha),
      descripcion: item.descripcion || '',
      referencia: item.referencia || '',
      tipo: item.tipo === 'INGRESO' ? 'INGRESO' : 'EGRESO',
      valor: normalizarValor(item.valor)
    }));
  } catch (error: any) {
    console.error("Error extrayendo datos del PDF:", error);
    if (error.name === 'AbortError') {
      throw new Error("La solicitud tardó demasiado (más de 15 segundos). Por favor, intenta de nuevo.");
    }
    throw new Error("No se pudo procesar el extracto bancario. Asegúrate de que la API Key esté configurada correctamente en Netlify.");
  }
};

const procesarDatosContables = (datosRaw: any[]): MovimientoContable[] => {
  const movimientos: MovimientoContable[] = [];

  datosRaw.forEach((row, index) => {
    const getCol = (matches: string[]) => {
      const keys = Object.keys(row);
      let key = keys.find(k => matches.some(m => k.trim().toLowerCase() === m.toLowerCase()));
      if (key) return row[key];
      for (const m of matches) {
        const foundKey = keys.find(k => k.toLowerCase().includes(m.toLowerCase()));
        if (foundKey) return row[foundKey];
      }
      return undefined;
    };

    const tercero = getCol(['Tercero', 'Nombre', 'Descripción', 'Detalle', 'NIT']) || 'S/N';
    const debito = normalizarValor(getCol(['Débito', 'Debito', 'Debe']));
    const credito = normalizarValor(getCol(['Crédito', 'Credito', 'Haber']));
    const comprobante = getCol(['Comprobante', 'Documento', 'Fuente']) || `CONT-${index}`;
    const fecha = getCol(['Fecha', 'Día']);
    const cuenta = getCol(['Cuenta', 'Codigo', 'Puc', 'Account', 'Código']) || '';

    if (debito === 0 && credito === 0) return;

    movimientos.push({
      id: comprobante,
      fecha: formatearFecha(fecha),
      tercero: String(tercero),
      debito,
      credito,
      cuenta: String(cuenta),
      netoLinea: debito - credito
    });
  });

  return movimientos;
};

const generarConciliacion = (banco: TransaccionBanco[], contable: MovimientoContable[]): ResultItem[] => {
  const resultados: ResultItem[] = [];
  const contableUsado = new Set<string>();

  // Conciliar Banco -> Contable
  banco.forEach((tb, index) => {
    let mejorMatch: MovimientoContable | null = null;
    let menorDiferencia = Infinity;

    for (const mc of contable) {
      if (contableUsado.has(mc.id)) continue;

      const valorContable = mc.debito > 0 ? mc.debito : mc.credito;
      const diferencia = Math.abs(tb.valor - valorContable);

      // Si la diferencia es pequeña (ej. < 100 pesos)
      if (diferencia < 100 && diferencia < menorDiferencia) {
        mejorMatch = mc;
        menorDiferencia = diferencia;
      }
    }

    if (mejorMatch) {
      contableUsado.add(mejorMatch.id);
      const valorContable = mejorMatch.debito > 0 ? mejorMatch.debito : mejorMatch.credito;
      resultados.push({
        id: `RES-${index}`,
        fechaBanco: tb.fecha,
        descripcionBanco: tb.descripcion,
        valorBanco: tb.valor,
        tipoBanco: tb.tipo,
        fechaContable: mejorMatch.fecha,
        terceroContable: mejorMatch.tercero,
        valorContable: valorContable,
        diferencia: tb.valor - valorContable,
        estado: 'CONCILIADO',
        movimientoBanco: tb,
        movimientoContable: mejorMatch
      });
    } else {
      resultados.push({
        id: `RES-${index}`,
        fechaBanco: tb.fecha,
        descripcionBanco: tb.descripcion,
        valorBanco: tb.valor,
        tipoBanco: tb.tipo,
        fechaContable: '-',
        terceroContable: '-',
        valorContable: 0,
        diferencia: tb.valor,
        estado: 'SOLO_BANCO',
        movimientoBanco: tb
      });
    }
  });

  // Agregar los contables no usados
  contable.forEach((mc, index) => {
    if (!contableUsado.has(mc.id)) {
      const valorContable = mc.debito > 0 ? mc.debito : mc.credito;
      resultados.push({
        id: `RES-C-${index}`,
        fechaBanco: '-',
        descripcionBanco: '-',
        valorBanco: 0,
        tipoBanco: '-',
        fechaContable: mc.fecha,
        terceroContable: mc.tercero,
        valorContable: valorContable,
        diferencia: -valorContable,
        estado: 'SOLO_CONTABLE',
        movimientoContable: mc
      });
    }
  });

  return resultados.sort((a, b) => {
    const score: Record<string, number> = { 'SOLO_BANCO': 0, 'SOLO_CONTABLE': 1, 'DIFERENCIA': 2, 'CONCILIADO': 3 };
    return score[a.estado] - score[b.estado];
  });
};

// ==================== COMPONENTES UI ====================

interface FileCardProps {
  title: string;
  file: File | null;
  count: number;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  color: string;
  icon: React.ElementType;
  accept: string;
}

const FileCard: React.FC<FileCardProps> = ({ title, file, count, onFileSelect, color, icon: Icon, accept }) => (
  <div className={`bg-white p-6 rounded-xl shadow-sm border-l-4 ${color} transition-all hover:shadow-md`}>
    <div className="flex justify-between items-start mb-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${color.replace('border-', 'bg-').replace('500', '100')} ${color.replace('border-', 'text-').replace('500', '700')}`}>
          <Icon size={24} />
        </div>
        <div>
          <h3 className="font-semibold text-gray-800">{title}</h3>
          <p className="text-xs text-gray-500">Formato {accept}</p>
        </div>
      </div>
      {file && <CheckCircle className="text-green-500" size={20} />}
    </div>
    
    <label className="block w-full group cursor-pointer">
      <div className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${file ? 'border-green-200 bg-green-50' : 'border-gray-200 hover:border-blue-400 hover:bg-gray-50'}`}>
        <input type="file" className="hidden" accept={accept} onChange={onFileSelect} />
        <span className="text-sm text-gray-600 group-hover:text-blue-600 font-medium truncate block">
          {file ? file.name : 'Seleccionar archivo'}
        </span>
      </div>
    </label>
    
    {count > 0 && (
      <div className="mt-3 flex justify-between items-center text-sm">
        <span className="text-gray-500">Registros leídos:</span>
        <span className="font-bold text-gray-800">{count}</span>
      </div>
    )}
  </div>
);

// ==================== COMPONENTE INFORME CONSOLIDADO ====================

interface ModalInformeProps {
  results: ResultItem[];
  data: DataState;
  onClose: () => void;
}

const ModalInformeConsolidado: React.FC<ModalInformeProps> = ({ results, data, onClose }) => {
  const { pagosPorRegistrar, consignaciones, ingresosBancarios, pagosBancarios, impuestosPagados, impuestosBancarios } = useMemo(() => {
    const pagosPorRegistrar: ResultItem[] = [];
    const consignaciones: ResultItem[] = [];
    const ingresosBancarios: ResultItem[] = [];
    const pagosBancarios: ResultItem[] = [];
    const impuestosPagados: ResultItem[] = [];
    const impuestosBancarios: ResultItem[] = [];

    results.forEach(r => {
      if (r.estado === 'SOLO_BANCO') {
        const desc = r.descripcionBanco.toUpperCase();
        if (r.tipoBanco === 'INGRESO') {
          if (desc.includes('INTERES') || desc.includes('ABONO') || desc.includes('RENDIMIENTO')) {
            ingresosBancarios.push(r);
          } else {
            consignaciones.push(r);
          }
        } else if (r.tipoBanco === 'EGRESO') {
          if (desc.includes('GMF') || desc.includes('4X1000')) {
            impuestosBancarios.push(r);
          } else if (desc.includes('IMPUESTO') || desc.includes('RETENCION') || desc.includes('RETE') || desc.includes('DIAN')) {
            impuestosPagados.push(r);
          } else if (desc.includes('COMISION') || desc.includes('CUOTA') || desc.includes('MANEJO') || desc.includes('INTERES') || desc.includes('BANCARIO')) {
            pagosBancarios.push(r);
          } else {
            pagosPorRegistrar.push(r);
          }
        }
      }
    });

    return { pagosPorRegistrar, consignaciones, ingresosBancarios, pagosBancarios, impuestosPagados, impuestosBancarios };
  }, [results]);

  const totalConciliados = results.filter(r => r.estado === 'CONCILIADO').length;
  const totalPendientes = results.length - totalConciliados;

  const saldoTotalLibros = data.contable.reduce((acc, mov) => acc + mov.credito, 0);
  const saldoTotalExtracto = data.banco.filter(t => t.tipo === 'EGRESO').reduce((acc, t) => acc + t.valor, 0);
  const totalIngresosBanco = data.banco.filter(t => t.tipo === 'INGRESO').reduce((acc, t) => acc + t.valor, 0);

  const sumValor = (items: ResultItem[]) => items.reduce((acc, item) => acc + item.valorBanco, 0);

  const exportarWord = () => {
    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
          "xmlns:w='urn:schemas-microsoft-com:office:word' " +
          "xmlns='http://www.w3.org/TR/REC-html40'>" +
          "<head><meta charset='utf-8'><title>Conciliacion Bancaria</title></head><body>";
    const footer = "</body></html>";
    const content = document.getElementById("informe-content")?.innerHTML || "";
    const sourceHTML = header + content + footer;
    
    const source = 'data:application/vnd.ms-word;charset=utf-8,' + encodeURIComponent(sourceHTML);
    const fileDownload = document.createElement("a");
    document.body.appendChild(fileDownload);
    fileDownload.href = source;
    fileDownload.download = 'Conciliacion_Bancaria.doc';
    fileDownload.click();
    document.body.removeChild(fileDownload);
  };

  const renderSection = (title: string, items: ResultItem[]) => (
    <div className="mb-6" style={{ marginBottom: '24px' }}>
      <p className="font-bold italic underline mb-2 text-sm" style={{ fontWeight: 'bold', fontStyle: 'italic', textDecoration: 'underline', marginBottom: '8px', fontSize: '14px' }}>{title}</p>
      <table className="w-full text-xs mb-2" style={{ width: '100%', fontSize: '12px', marginBottom: '8px', borderCollapse: 'collapse' }}>
        <thead>
          <tr className="border-b border-slate-400" style={{ borderBottom: '1px solid #94a3b8' }}>
            <th className="text-left py-1 w-24" style={{ textAlign: 'left', padding: '4px 0', width: '96px' }}>FECHA</th>
            <th className="text-left py-1" style={{ textAlign: 'left', padding: '4px 0' }}>DETALLE</th>
            <th className="text-right py-1 w-32" style={{ textAlign: 'right', padding: '4px 0', width: '128px' }}>VALOR</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i}>
              <td className="py-1" style={{ padding: '4px 0' }}>{item.fechaBanco}</td>
              <td className="py-1 truncate max-w-[400px]" style={{ padding: '4px 0' }}>{item.descripcionBanco}</td>
              <td className="py-1 text-right" style={{ textAlign: 'right', padding: '4px 0' }}>{formatearMoneda(item.valorBanco)}</td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={3} className="py-2 text-center text-slate-400 italic" style={{ padding: '8px 0', textAlign: 'center', fontStyle: 'italic', color: '#94a3b8' }}>No hay registros en esta categoría</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="flex justify-end font-bold border-t-2 border-double border-slate-800 pt-1" style={{ display: 'flex', justifyContent: 'flex-end', fontWeight: 'bold', borderTop: '3px double #1e293b', paddingTop: '4px' }}>
        <span className="w-32 text-right" style={{ width: '128px', textAlign: 'right' }}>{formatearMoneda(sumValor(items))}</span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2"><FileText size={24}/> Informe Consolidado</h2>
            <p className="text-slate-400 text-xs mt-1">Resumen de la conciliación bancaria</p>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={exportarWord} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
              <Download size={16} /> Descargar DOCS
            </button>
            <button onClick={onClose}><XCircle size={28} className="hover:text-red-400 transition-colors"/></button>
          </div>
        </div>
        
        <div className="p-8 overflow-y-auto bg-slate-50 flex-1 text-sm text-slate-800">
          
          {/* Resumen de Estados */}
          <div className="flex gap-4 mb-8 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex-1 text-center border-r border-slate-200">
              <p className="text-xs text-slate-500 font-bold uppercase">Total Movimientos</p>
              <p className="text-2xl font-bold text-slate-800">{results.length}</p>
            </div>
            <div className="flex-1 text-center border-r border-slate-200">
              <p className="text-xs text-green-600 font-bold uppercase">Conciliados (Cuadran)</p>
              <p className="text-2xl font-bold text-green-700">{totalConciliados}</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-xs text-red-500 font-bold uppercase">Pendientes (Diferencias)</p>
              <p className="text-2xl font-bold text-red-600">{totalPendientes}</p>
            </div>
          </div>

          {/* Formato de Informe (Estilo Documento) */}
          <div className="border-2 border-slate-800 p-8 font-serif bg-white mx-auto max-w-3xl shadow-sm" id="informe-content" style={{ fontFamily: 'serif', padding: '32px', border: '2px solid #1e293b', backgroundColor: 'white', color: 'black' }}>
            <div className="text-center font-bold mb-6 leading-tight text-sm" style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: '24px', fontSize: '14px' }}>
              <p>NOMBRE EMPRESA</p>
              <p>NIT XXX.XXX.XXX-4</p>
              <p>CONCILIACION BANCARIA</p>
              <p>MES DE PROCESO</p>
              <p>CTA. DE AHORROS / CORRIENTE</p>
            </div>

            <div className="flex justify-between font-bold bg-slate-200 px-2 py-1 mb-1 text-sm" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', backgroundColor: '#e2e8f0', padding: '4px 8px', marginBottom: '4px', fontSize: '14px' }}>
              <span>SALDO TOTAL EN LIBROS (Egresos Contabilidad)</span>
              <span>{formatearMoneda(saldoTotalLibros)}</span>
            </div>
            <div className="flex justify-between font-bold bg-blue-900 text-white px-2 py-1 mb-1 text-sm" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', backgroundColor: '#1e3a8a', color: 'white', padding: '4px 8px', marginBottom: '4px', fontSize: '14px' }}>
              <span>SALDO TOTAL DEL EXTRACTO (Egresos Banco)</span>
              <span>{formatearMoneda(saldoTotalExtracto)}</span>
            </div>
            <div className="flex justify-between font-bold bg-green-800 text-white px-2 py-1 mb-8 text-sm" style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', backgroundColor: '#166534', color: 'white', padding: '4px 8px', marginBottom: '32px', fontSize: '14px' }}>
              <span>TOTAL INGRESOS BANCO</span>
              <span>{formatearMoneda(totalIngresosBanco)}</span>
            </div>

            {renderSection('PAGOS POR REGISTRAR EN CONTABILIDAD', pagosPorRegistrar)}
            {renderSection('CONSIGNACIONES NO REGISTRADAS EN CONTABILIDAD', consignaciones)}
            {renderSection('INGRESOS BANCARIOS (INTERESES/ABONOS)', ingresosBancarios)}
            {renderSection('TOTAL PAGOS BANCARIOS (COMISIONES/CUOTAS)', pagosBancarios)}
            {renderSection('IMPUESTOS PAGADOS (DIAN/RETENCIONES)', impuestosPagados)}
            {renderSection('IMPUESTOS BANCARIOS DESCONTADOS (GMF/4X1000)', impuestosBancarios)}

            <div className="mt-16 flex justify-between px-8" style={{ marginTop: '64px', display: 'flex', justifyContent: 'space-between', padding: '0 32px' }}>
              <div className="w-48 border-t-2 border-slate-800 text-center pt-2 font-bold text-xs" style={{ width: '192px', borderTop: '2px solid #1e293b', textAlign: 'center', paddingTop: '8px', fontWeight: 'bold', fontSize: '12px' }}>
                ELABORADO POR
              </div>
              <div className="w-48 border-t-2 border-slate-800 text-center pt-2 font-bold text-xs" style={{ width: '192px', borderTop: '2px solid #1e293b', textAlign: 'center', paddingTop: '8px', fontWeight: 'bold', fontSize: '12px' }}>
                REVISADO POR
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [files, setFiles] = useState<FileState>({ contable: null, banco: null });
  const [data, setData] = useState<DataState>({ contable: [], banco: [] });
  const [results, setResults] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showInforme, setShowInforme] = useState(false);

  const handleFile = async (type: 'contable' | 'banco', e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setFiles(prev => ({ ...prev, [type]: file }));
    }
  };

  const procesarArchivos = async () => {
    if (!files.banco || !files.contable) {
      alert("Por favor selecciona ambos archivos.");
      return;
    }

    setLoading(true);
    try {
      // 1. Procesar Contable (Excel)
      setLoadingMsg("Procesando Auxiliar Contable...");
      const buffer = await files.contable.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      const contableData = procesarDatosContables(jsonData);

      // 2. Procesar Banco (PDF con Gemini)
      setLoadingMsg("Extrayendo datos del Extracto Bancario (PDF) con IA...");
      const bancoData = await extraerDatosBancoPDF(files.banco);

      setData({ contable: contableData, banco: bancoData });

      // 3. Conciliar
      setLoadingMsg("Conciliando transacciones...");
      const res = generarConciliacion(bancoData, contableData);
      setResults(res);

    } catch (error: any) {
      console.error(error);
      alert('Error durante el procesamiento: ' + error.message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const filteredResults = useMemo(() => {
    return results.filter(r => 
      r.descripcionBanco.toLowerCase().includes(searchTerm.toLowerCase()) || 
      r.terceroContable.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.estado.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [results, searchTerm]);

  const exportarExcel = () => {
    if (results.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(results.map(r => ({
      'Fecha Banco': r.fechaBanco,
      'Descripción Banco': r.descripcionBanco,
      'Valor Banco': r.valorBanco,
      'Tipo Banco': r.tipoBanco,
      'Fecha Contable': r.fechaContable,
      'Tercero Contable': r.terceroContable,
      'Valor Contable': r.valorContable,
      'Diferencia': r.diferencia,
      'Estado': r.estado
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Conciliación Bancaria");
    XLSX.writeFile(wb, "conciliacion_bancaria.xlsx");
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-10">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-20 px-6 py-4 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg text-white">
                <RefreshCw size={24} />
            </div>
            <div>
                <h1 className="text-xl font-bold leading-tight">Conciliador Bancario Pro</h1>
                <p className="text-xs text-slate-500">Extractos PDF vs Auxiliar Contable</p>
            </div>
        </div>
        <div className="flex gap-2">
           {results.length > 0 && (
             <button 
                onClick={() => setShowInforme(true)} 
                className="text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
             >
                <FileText size={16} /> Informe Consolidado
             </button>
           )}
           <button onClick={() => window.location.reload()} className="text-slate-500 hover:text-blue-600 text-sm font-medium flex items-center gap-2 ml-2">
              <RefreshCw size={14} /> Nueva Conciliación
           </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Upload Section */}
        <div className="grid md:grid-cols-2 gap-6">
            <FileCard 
                title="Extracto Bancario (PDF)" 
                file={files.banco} 
                count={data.banco.length}
                onFileSelect={(e) => handleFile('banco', e)} 
                color="border-blue-500"
                icon={FileIcon}
                accept=".pdf"
            />
            <FileCard 
                title="Auxiliar Contable (Excel)" 
                file={files.contable} 
                count={data.contable.length}
                onFileSelect={(e) => handleFile('contable', e)} 
                color="border-purple-500"
                icon={FileSpreadsheet}
                accept=".xlsx,.xls,.csv"
            />
        </div>

        {files.banco && files.contable && results.length === 0 && !loading && (
          <div className="flex justify-center">
            <button 
              onClick={procesarArchivos}
              className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-transform hover:scale-105"
            >
              Iniciar Conciliación
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
            <div className="text-center py-10">
                <div className="animate-spin inline-block w-8 h-8 border-4 border-current border-t-transparent text-blue-600 rounded-full mb-4"></div>
                <p className="text-slate-600 font-medium">{loadingMsg}</p>
            </div>
        )}

        {/* Results */}
        {results.length > 0 && !loading && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
                
                {/* Controls */}
                <div className="flex flex-col md:flex-row justify-between items-end gap-4">
                    <div className="flex gap-4">
                        <div className="bg-white border rounded-lg px-4 py-2 shadow-sm">
                            <span className="text-xs font-bold text-gray-400 uppercase">Total Movs</span>
                            <span className="block text-xl font-bold">{results.length}</span>
                        </div>
                        <div className="bg-white border rounded-lg px-4 py-2 shadow-sm border-l-4 border-l-green-500">
                            <span className="text-xs font-bold text-gray-400 uppercase">Conciliados</span>
                            <span className="block text-xl font-bold text-green-600">{results.filter(r => r.estado === 'CONCILIADO').length}</span>
                        </div>
                        <div className="bg-white border rounded-lg px-4 py-2 shadow-sm border-l-4 border-l-red-500">
                            <span className="text-xs font-bold text-gray-400 uppercase">Pendientes</span>
                            <span className="block text-xl font-bold text-red-600">{results.filter(r => r.estado !== 'CONCILIADO').length}</span>
                        </div>
                    </div>

                    <div className="flex gap-3 w-full md:w-auto">
                        <div className="relative flex-1 md:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                            <input 
                                type="text" 
                                placeholder="Buscar descripción o tercero..." 
                                className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button 
                            onClick={exportarExcel}
                            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 shadow-sm transition-colors"
                        >
                            <Download size={18} /> Exportar
                        </button>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-xs border-b">
                                <tr>
                                    <th className="px-4 py-3" colSpan={3}>Extracto Bancario</th>
                                    <th className="px-4 py-3 border-l" colSpan={3}>Auxiliar Contable</th>
                                    <th className="px-4 py-3 border-l text-center" rowSpan={2}>Estado</th>
                                </tr>
                                <tr className="border-b">
                                    <th className="px-4 py-2 text-xs">Fecha</th>
                                    <th className="px-4 py-2 text-xs">Descripción</th>
                                    <th className="px-4 py-2 text-xs text-right">Valor</th>
                                    <th className="px-4 py-2 text-xs border-l">Fecha</th>
                                    <th className="px-4 py-2 text-xs">Tercero/Detalle</th>
                                    <th className="px-4 py-2 text-xs text-right">Valor</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredResults.map((r, i) => (
                                    <tr key={i} className="hover:bg-slate-50 transition-colors">
                                        {/* Banco */}
                                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{r.fechaBanco}</td>
                                        <td className="px-4 py-3 font-medium text-slate-700 max-w-[200px] truncate" title={r.descripcionBanco}>
                                          {r.descripcionBanco}
                                          {r.tipoBanco !== '-' && (
                                            <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold ${r.tipoBanco === 'INGRESO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                              {r.tipoBanco}
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-600">{r.valorBanco ? formatearMoneda(r.valorBanco) : '-'}</td>
                                        
                                        {/* Contable */}
                                        <td className="px-4 py-3 text-slate-500 border-l whitespace-nowrap">{r.fechaContable}</td>
                                        <td className="px-4 py-3 font-medium text-slate-700 max-w-[200px] truncate" title={r.terceroContable}>{r.terceroContable}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-600">{r.valorContable ? formatearMoneda(r.valorContable) : '-'}</td>
                                        
                                        {/* Estado */}
                                        <td className="px-4 py-3 text-center border-l">
                                            {r.estado === 'CONCILIADO' && <span className="inline-flex items-center gap-1 text-green-700 bg-green-50 px-2 py-1 rounded-full text-xs font-bold"><CheckCircle size={12}/> OK</span>}
                                            {r.estado === 'SOLO_BANCO' && <span className="inline-flex items-center gap-1 text-blue-700 bg-blue-50 px-2 py-1 rounded-full text-xs font-bold"><AlertTriangle size={12}/> FALTA EN CONTAB</span>}
                                            {r.estado === 'SOLO_CONTABLE' && <span className="inline-flex items-center gap-1 text-purple-700 bg-purple-50 px-2 py-1 rounded-full text-xs font-bold"><AlertTriangle size={12}/> FALTA EN BANCO</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Legend / Info Footer */}
                <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-slate-600 bg-white p-4 rounded-xl border border-slate-200">
                  <div>
                    <h3 className="font-bold mb-2 text-slate-800 flex items-center gap-2"><Info size={16}/> Guía de Estados</h3>
                    <ul className="space-y-2">
                      <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-500"></span> <b>OK:</b> Movimiento encontrado en banco y contabilidad por el mismo valor.</li>
                      <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-500"></span> <b>FALTA EN CONTAB:</b> Movimiento bancario que no tiene contrapartida en el auxiliar contable.</li>
                      <li className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-purple-500"></span> <b>FALTA EN BANCO:</b> Registro contable que no aparece en el extracto bancario.</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-bold mb-2 text-slate-800 flex items-center gap-2"><FileText size={16}/> Notas sobre la IA</h3>
                    <p className="mb-2">La extracción del PDF utiliza Inteligencia Artificial:</p>
                    <ul className="space-y-2">
                      <li className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 text-blue-500"><CheckCircle size={14}/></span>
                        Puede procesar formatos de cualquier banco automáticamente.
                      </li>
                      <li className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 text-blue-500"><CheckCircle size={14}/></span>
                        Identifica fechas, descripciones y valores sin necesidad de plantillas.
                      </li>
                    </ul>
                  </div>
                </div>

            </div>
        )}
      </main>

      {showInforme && (
        <ModalInformeConsolidado 
          results={results} 
          data={data}
          onClose={() => setShowInforme(false)} 
        />
      )}

    </div>
  );
}

export default App;
