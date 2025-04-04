import {
  useState,
  useEffect,
  useRef,
  ChangeEvent,
  DragEvent,
  useMemo,
} from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable"; // Changed to direct import
import * as XLSX from "xlsx";
import { Toaster, toast } from "sonner";
import {
  Download,
  FileText,
  FileSpreadsheet,
  Upload,
  X,
  Info,
  AlertCircle,
  ChevronUp,
  ChevronDown,
  Search,
  Calendar,
  ArrowUp,
  ArrowDown,
  Inbox,
  TrendingDown,
  CreditCard,
} from "lucide-react";

// shadcn components
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";

// RFC Pattern for Mexican tax IDs
const RFC_PATTERN = {
  MORAL: /^[A-Za-z]{3}[0-9]{6}[A-Za-z0-9]{3}$/, // For corporations (13 chars)
  FISICA: /^[A-Za-z]{4}[0-9]{6}[A-Za-z0-9]{3}$/, // For individuals (13 chars)
};

// Define interfaces for our component state
interface InvoiceData {
  empresaNombre: string; // Denominación/Razón Social
  nombreComercial: string; // Nombre Comercial
  rfc: string;
  domicilioFiscal: string;
  regimenFiscal: string;
}

interface XmlFile {
  name: string;
  content: string;
  size: number;
  type: string;
}

interface ValidationErrors {
  empresaNombre?: string;
  nombreComercial?: string;
  rfc?: string;
  domicilioFiscal?: string;
  regimenFiscal?: string;
}

interface Concepto {
  descripcion: string;
  valorUnitario: number;
  importe: number;
  cantidad: number;
  impuestos: number;
  claveProdServ?: string;
  claveUnidad?: string;
  unidad?: string;
}

interface InvoiceDataParsed {
  uuid: string;
  fecha: string;
  fechaTimbrado: string;
  serie?: string;
  folio?: string;
  emisor: {
    rfc: string;
    nombre: string;
    regimenFiscal: string;
  };
  receptor: {
    rfc: string;
    nombre: string;
    usoCFDI: string;
    domicilioFiscalReceptor?: string;
  };
  comprobante: {
    total: number;
    subTotal: number;
    formaPago: string;
    metodoPago: string;
    tipoComprobante: string;
    moneda?: string;
    tipoCambio?: number;
    exportacion?: string;
  };
  conceptos: Concepto[];
  impuestos: {
    totalImpuestosTrasladados: number;
    traslados?: Array<{
      impuesto: string;
      importe: number;
      tasa: number;
      tipoFactor: string;
    }>;
  };
  // Display values for reports (affected by tipoComprobante)
  displayValues?: {
    total: number;
    subTotal: number;
    impuestos: number;
    prefix: string;
  };
}

interface ProcessedInvoice {
  fileName: string;
  data: InvoiceDataParsed;
}

interface MonthlySummary {
  count: number;
  total: number;
  taxes: number;
  subtotal: number;
  ingresos: number;
  egresos: number;
  pagos: number;
  ingresoCount: number;
  egresoCount: number;
  pagoCount: number;
  otherCount: number;
}

interface TypeSummary {
  count: number;
  total: number;
  taxes: number;
  subtotal: number;
}

interface ProcessedData {
  invoices: ProcessedInvoice[];
  summary: {
    totalAmount: number;
    totalTaxes: number;
    totalSubtotal: number;
    invoiceCount: number;
    ingresosCount: number;
    egresosCount: number;
    pagosCount: number;
    ingresosTotal: number;
    egresosTotal: number;
    pagosTotal: number;
    byMonth?: Record<string, MonthlySummary>;
    byTipoComprobante?: Record<string, TypeSummary>;
    dateRange: {
      minDate: string;
      maxDate: string;
    };
  };
}

// Sorting and filtering types
interface SortConfig {
  key: string;
  direction: "asc" | "desc";
}

interface FilterConfig {
  [key: string]: string | number | null;
}

interface PaginationConfig {
  currentPage: number;
  pageSize: number;
  totalItems: number;
}

// Helper for rounding to 2 decimal places for consistent calculations
const roundToTwo = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

// Helper for formatting currency
const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Get form pago display text
const getFormaPagoText = (formaPago: string): string => {
  const formasPago: Record<string, string> = {
    "01": "Efectivo",
    "02": "Cheque nominativo",
    "03": "Transferencia electrónica de fondos",
    "04": "Tarjeta de crédito",
    "05": "Monedero electrónico",
    "06": "Dinero electrónico",
    "08": "Vales de despensa",
    "12": "Dación en pago",
    "13": "Pago por subrogación",
    "14": "Pago por consignación",
    "15": "Condonación",
    "17": "Compensación",
    "23": "Novación",
    "24": "Confusión",
    "25": "Remisión de deuda",
    "26": "Prescripción o caducidad",
    "27": "A satisfacción del acreedor",
    "28": "Tarjeta de débito",
    "29": "Tarjeta de servicios",
    "30": "Aplicación de anticipos",
    "31": "Intermediario pagos",
    "99": "Por definir",
  };

  return formasPago[formaPago] || formaPago;
};

// Get metodo pago display text
const getMetodoPagoText = (metodoPago: string): string => {
  const metodosPago: Record<string, string> = {
    PUE: "Pago en una sola exhibición",
    PPD: "Pago en parcialidades o diferido",
  };

  return metodosPago[metodoPago] || metodoPago;
};

// Get tipo comprobante display text
const getTipoComprobanteText = (tipoComprobante: string): string => {
  const tiposComprobante: Record<string, string> = {
    I: "Ingreso",
    E: "Egreso",
    T: "Traslado",
    N: "Nómina",
    P: "Pago",
  };

  return tiposComprobante[tipoComprobante] || tipoComprobante;
};

// Get tipo comprobante color
const getTipoComprobanteColor = (tipoComprobante: string): string => {
  const colors: Record<string, string> = {
    I: "text-green-700 bg-green-100 hover:bg-green-200 border-green-300",
    E: "text-red-700 bg-red-100 hover:bg-red-200 border-red-300",
    P: "text-blue-700 bg-blue-100 hover:bg-blue-200 border-blue-300",
    T: "text-amber-700 bg-amber-100 hover:bg-amber-200 border-amber-300",
    N: "text-purple-700 bg-purple-100 hover:bg-purple-200 border-purple-300",
  };

  return (
    colors[tipoComprobante] ||
    "text-gray-700 bg-gray-100 hover:bg-gray-200 border-gray-300"
  );
};

// Get tipo comprobante badge
const getTipoComprobanteBadge = (tipo: string) => {
  const badgeClasses = `px-2 py-1 rounded-full text-xs font-medium ${getTipoComprobanteColor(
    tipo
  )}`;

  let icon = null;
  switch (tipo) {
    case "I":
      icon = <ArrowUp className="inline mr-1 h-3 w-3" />;
      break;
    case "E":
      icon = <ArrowDown className="inline mr-1 h-3 w-3" />;
      break;
    case "P":
      icon = <CreditCard className="inline mr-1 h-3 w-3" />;
      break;
    case "T":
      icon = <TrendingDown className="inline mr-1 h-3 w-3" />;
      break;
    default:
      break;
  }

  return (
    <span className={badgeClasses}>
      {icon}
      {getTipoComprobanteText(tipo)}
    </span>
  );
};

// Get uso CFDI display text
const getUsoCFDIText = (usoCFDI: string): string => {
  const usosCFDI: Record<string, string> = {
    G01: "Adquisición de mercancías",
    G02: "Devoluciones, descuentos o bonificaciones",
    G03: "Gastos en general",
    I01: "Construcciones",
    I02: "Mobiliario y equipo de oficina",
    I03: "Equipo de transporte",
    I04: "Equipo de cómputo",
    I05: "Dados, troqueles, moldes, matrices y herramental",
    I06: "Comunicaciones telefónicas",
    I07: "Comunicaciones satelitales",
    I08: "Otra maquinaria y equipo",
    D01: "Honorarios médicos, dentales y gastos hospitalarios",
    D02: "Gastos médicos por incapacidad o discapacidad",
    D03: "Gastos funerales",
    D04: "Donativos",
    D05: "Intereses reales efectivamente pagados por créditos hipotecarios",
    D06: "Aportaciones voluntarias al SAR",
    D07: "Primas por seguros de gastos médicos",
    D08: "Gastos de transportación escolar obligatoria",
    D09: "Depósitos en cuentas para el ahorro",
    D10: "Pagos por servicios educativos (colegiaturas)",
    S01: "Sin efectos fiscales",
    CP01: "Pagos",
    CN01: "Nómina",
  };

  return usosCFDI[usoCFDI] || usoCFDI;
};

// Get regimen fiscal display text
const getRegimenFiscalText = (regimenFiscal: string): string => {
  const regimenesFiscales: Record<string, string> = {
    "601": "General de Ley Personas Morales",
    "603": "Personas Morales con Fines no Lucrativos",
    "605": "Sueldos y Salarios e Ingresos Asimilados a Salarios",
    "606": "Arrendamiento",
    "607": "Régimen de Enajenación o Adquisición de Bienes",
    "608": "Demás ingresos",
    "609": "Consolidación",
    "610":
      "Residentes en el Extranjero sin Establecimiento Permanente en México",
    "611": "Ingresos por Dividendos (socios y accionistas)",
    "612": "Personas Físicas con Actividades Empresariales y Profesionales",
    "614": "Ingresos por intereses",
    "615": "Régimen de los ingresos por obtención de premios",
    "616": "Sin obligaciones fiscales",
    "620":
      "Sociedades Cooperativas de Producción que optan por diferir sus ingresos",
    "621": "Incorporación Fiscal",
    "622": "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras",
    "623": "Opcional para Grupos de Sociedades",
    "624": "Coordinados",
    "625":
      "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas",
    "626": "Régimen Simplificado de Confianza",
    "628": "Hidrocarburos",
    "629":
      "De los Regímenes Fiscales Preferentes y de las Empresas Multinacionales",
    "630": "Enajenación de acciones en bolsa de valores",
  };

  return regimenesFiscales[regimenFiscal] || regimenFiscal;
};

// Get month name from number
const getMonthName = (monthNum: string): string => {
  const months = [
    { value: "01", label: "Enero" },
    { value: "02", label: "Febrero" },
    { value: "03", label: "Marzo" },
    { value: "04", label: "Abril" },
    { value: "05", label: "Mayo" },
    { value: "06", label: "Junio" },
    { value: "07", label: "Julio" },
    { value: "08", label: "Agosto" },
    { value: "09", label: "Septiembre" },
    { value: "10", label: "Octubre" },
    { value: "11", label: "Noviembre" },
    { value: "12", label: "Diciembre" },
  ];
  return months.find((m) => m.value === monthNum)?.label || monthNum;
};

// Calculate display values based on tipo comprobante
const calculateDisplayValues = (
  invoice: InvoiceDataParsed
): InvoiceDataParsed => {
  const tipo = invoice.comprobante.tipoComprobante;
  const isEgreso = tipo === "E";

  const displayValues = {
    total: isEgreso
      ? -Math.abs(invoice.comprobante.total)
      : invoice.comprobante.total,
    subTotal: isEgreso
      ? -Math.abs(invoice.comprobante.subTotal)
      : invoice.comprobante.subTotal,
    impuestos: isEgreso
      ? -Math.abs(invoice.impuestos.totalImpuestosTrasladados)
      : invoice.impuestos.totalImpuestosTrasladados,
    prefix: isEgreso ? "-" : "",
  };

  return {
    ...invoice,
    displayValues,
  };
};

// Main component
const App = () => {
  const [invoiceData, setInvoiceData] = useState<InvoiceData>({
    empresaNombre: "",
    nombreComercial: "",
    rfc: "",
    domicilioFiscal: "",
    regimenFiscal: "",
  });

  const [errors, setErrors] = useState<ValidationErrors>({});
  const [xmlFiles, setXmlFiles] = useState<XmlFile[]>([]);
  const [currentXmlPage, setCurrentXmlPage] = useState<number>(1);
  const xmlFilesPerPage = 10;
  const [processedData, setProcessedData] = useState<ProcessedData | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<string>("upload");
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<number>(0);

  // Sorting and filtering states
  const [invoiceSort, setInvoiceSort] = useState<SortConfig>({
    key: "fecha",
    direction: "desc",
  });
  const [invoiceFilter, setInvoiceFilter] = useState<FilterConfig>({});
  const [invoiceSearch, setInvoiceSearch] = useState<string>("");
  const [invoicePagination, setInvoicePagination] = useState<PaginationConfig>({
    currentPage: 1,
    pageSize: 10,
    totalItems: 0,
  });

  const [conceptSort, setConceptSort] = useState<SortConfig>({
    key: "fecha",
    direction: "desc",
  });
  const [conceptFilter, setConceptFilter] = useState<FilterConfig>({});
  const [conceptSearch, setConceptSearch] = useState<string>("");
  const [conceptPagination, setConceptPagination] = useState<PaginationConfig>({
    currentPage: 1,
    pageSize: 10,
    totalItems: 0,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Validate RFC
  const validateRFC = (rfc: string): boolean => {
    return RFC_PATTERN.MORAL.test(rfc) || RFC_PATTERN.FISICA.test(rfc);
  };

  // Validate form inputs
  const validateInputs = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (!invoiceData.empresaNombre.trim()) {
      newErrors.empresaNombre = "La Denominación/Razón Social es requerida";
    } else if (invoiceData.empresaNombre.length < 3) {
      newErrors.empresaNombre =
        "La Denominación/Razón Social debe tener al menos 3 caracteres";
    }

    if (!invoiceData.nombreComercial.trim()) {
      newErrors.nombreComercial = "El Nombre Comercial es requerido";
    }

    if (!invoiceData.rfc.trim()) {
      newErrors.rfc = "El RFC es requerido";
    } else if (!validateRFC(invoiceData.rfc)) {
      newErrors.rfc = "El RFC no tiene el formato correcto";
    }

    if (!invoiceData.domicilioFiscal.trim()) {
      newErrors.domicilioFiscal = "El domicilio fiscal es requerido";
    }

    if (!invoiceData.regimenFiscal) {
      newErrors.regimenFiscal = "El Régimen Fiscal es requerido";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Reset pagination when filters change
  useEffect(() => {
    if (processedData) {
      setInvoicePagination((prev) => ({
        ...prev,
        currentPage: 1,
        totalItems: processedData.invoices.length,
      }));
    }
  }, [invoiceFilter, invoiceSearch, processedData]);

  useEffect(() => {
    if (processedData) {
      const totalConcepts = processedData.invoices.reduce(
        (total, invoice) => total + invoice.data.conceptos.length,
        0
      );

      setConceptPagination((prev) => ({
        ...prev,
        currentPage: 1,
        totalItems: totalConcepts,
      }));
    }
  }, [conceptFilter, conceptSearch, processedData]);

  // Setup drag and drop handlers
  useEffect(() => {
    const dropZone = dropZoneRef.current;
    if (!dropZone) return;

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(true);
    };

    const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files).filter(
        (file) => file.type === "text/xml" || file.name.endsWith(".xml")
      );

      if (files.length > 0) {
        toast.success(`${files.length} archivos XML detectados`);
        processFiles(files);
      } else {
        toast.error("No se detectaron archivos XML válidos");
      }
    };

    // Add event listeners for dropzone
    dropZone.addEventListener("dragover", handleDragOver as any);
    dropZone.addEventListener("dragleave", handleDragLeave as any);
    dropZone.addEventListener("drop", handleDrop as any);

    // Cleanup event listeners
    return () => {
      dropZone.removeEventListener("dragover", handleDragOver as any);
      dropZone.removeEventListener("dragleave", handleDragLeave as any);
      dropZone.removeEventListener("drop", handleDrop as any);
    };
  }, []);

  // Filter and sort invoices
  const filteredInvoices = useMemo(() => {
    if (!processedData) return [];

    let result = [...processedData.invoices];

    // Apply text search
    if (invoiceSearch) {
      const searchLower = invoiceSearch.toLowerCase();
      result = result.filter(
        (invoice) =>
          invoice.data.uuid.toLowerCase().includes(searchLower) ||
          invoice.data.emisor.nombre.toLowerCase().includes(searchLower) ||
          invoice.data.emisor.rfc.toLowerCase().includes(searchLower) ||
          (invoice.data.folio &&
            invoice.data.folio.toLowerCase().includes(searchLower)) ||
          (invoice.data.serie &&
            invoice.data.serie.toLowerCase().includes(searchLower))
      );
    }

    // Apply filters
    Object.entries(invoiceFilter).forEach(([key, value]) => {
      if (value) {
        switch (key) {
          case "uuid":
            result = result.filter((invoice) =>
              invoice.data.uuid
                .toLowerCase()
                .includes(String(value).toLowerCase())
            );
            break;
          case "folio":
            result = result.filter((invoice) =>
              (invoice.data.folio || "")
                .toLowerCase()
                .includes(String(value).toLowerCase())
            );
            break;
          case "fecha":
            result = result.filter((invoice) =>
              invoice.data.fecha.includes(String(value))
            );
            break;
          case "emisor":
            result = result.filter(
              (invoice) =>
                invoice.data.emisor.nombre
                  .toLowerCase()
                  .includes(String(value).toLowerCase()) ||
                invoice.data.emisor.rfc
                  .toLowerCase()
                  .includes(String(value).toLowerCase())
            );
            break;
          case "tipo":
            if (value !== "all") {
              result = result.filter(
                (invoice) => invoice.data.comprobante.tipoComprobante === value
              );
            }
            break;
          // Add more filter cases as needed
        }
      }
    });

    // Apply sorting
    result.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (invoiceSort.key) {
        case "uuid":
          aValue = a.data.uuid;
          bValue = b.data.uuid;
          break;
        case "folio":
          aValue = a.data.folio || "";
          bValue = b.data.folio || "";
          break;
        case "fecha":
          aValue = new Date(a.data.fecha).getTime();
          bValue = new Date(b.data.fecha).getTime();
          break;
        case "emisor":
          aValue = a.data.emisor.nombre;
          bValue = b.data.emisor.nombre;
          break;
        case "tipo":
          aValue = a.data.comprobante.tipoComprobante;
          bValue = b.data.comprobante.tipoComprobante;
          break;
        case "subtotal":
          aValue =
            a.data.displayValues?.subTotal || a.data.comprobante.subTotal;
          bValue =
            b.data.displayValues?.subTotal || b.data.comprobante.subTotal;
          break;
        case "impuestos":
          aValue =
            a.data.displayValues?.impuestos ||
            a.data.impuestos.totalImpuestosTrasladados;
          bValue =
            b.data.displayValues?.impuestos ||
            b.data.impuestos.totalImpuestosTrasladados;
          break;
        case "total":
          aValue = a.data.displayValues?.total || a.data.comprobante.total;
          bValue = b.data.displayValues?.total || b.data.comprobante.total;
          break;
        default:
          aValue = a.data.fecha;
          bValue = b.data.fecha;
      }

      // Handle string comparison
      if (typeof aValue === "string" && typeof bValue === "string") {
        return invoiceSort.direction === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // Handle number comparison
      return invoiceSort.direction === "asc"
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return result;
  }, [processedData, invoiceSearch, invoiceFilter, invoiceSort]);

  // Get paginated invoices
  const paginatedInvoices = useMemo(() => {
    const startIndex =
      (invoicePagination.currentPage - 1) * invoicePagination.pageSize;
    return filteredInvoices.slice(
      startIndex,
      startIndex + invoicePagination.pageSize
    );
  }, [filteredInvoices, invoicePagination]);

  // Calculate total pages
  const totalInvoicePages = useMemo(() => {
    return Math.ceil(filteredInvoices.length / invoicePagination.pageSize);
  }, [filteredInvoices.length, invoicePagination.pageSize]);

  // Filter and sort concepts
  const filteredConcepts = useMemo(() => {
    if (!processedData) return [];

    // Flatten all concepts from all invoices
    let allConcepts: Array<{
      invoiceData: InvoiceDataParsed;
      concepto: Concepto;
    }> = [];

    processedData.invoices.forEach((invoice) => {
      invoice.data.conceptos.forEach((concepto) => {
        allConcepts.push({
          invoiceData: invoice.data,
          concepto,
        });
      });
    });

    // Apply text search
    if (conceptSearch) {
      const searchLower = conceptSearch.toLowerCase();
      allConcepts = allConcepts.filter(
        ({ invoiceData, concepto }) =>
          invoiceData.uuid.toLowerCase().includes(searchLower) ||
          concepto.descripcion.toLowerCase().includes(searchLower) ||
          (concepto.claveProdServ &&
            concepto.claveProdServ.toLowerCase().includes(searchLower))
      );
    }

    // Apply filters
    Object.entries(conceptFilter).forEach(([key, value]) => {
      if (value) {
        switch (key) {
          case "uuid":
            allConcepts = allConcepts.filter(({ invoiceData }) =>
              invoiceData.uuid
                .toLowerCase()
                .includes(String(value).toLowerCase())
            );
            break;
          case "fecha":
            allConcepts = allConcepts.filter(({ invoiceData }) =>
              invoiceData.fecha.includes(String(value))
            );
            break;
          case "descripcion":
            allConcepts = allConcepts.filter(({ concepto }) =>
              concepto.descripcion
                .toLowerCase()
                .includes(String(value).toLowerCase())
            );
            break;
          case "tipo":
            if (value !== "all") {
              allConcepts = allConcepts.filter(
                ({ invoiceData }) =>
                  invoiceData.comprobante.tipoComprobante === value
              );
            }
            break;
          // Add more filter cases as needed
        }
      }
    });

    // Apply sorting
    allConcepts.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (conceptSort.key) {
        case "uuid":
          aValue = a.invoiceData.uuid;
          bValue = b.invoiceData.uuid;
          break;
        case "fecha":
          aValue = new Date(a.invoiceData.fecha).getTime();
          bValue = new Date(b.invoiceData.fecha).getTime();
          break;
        case "descripcion":
          aValue = a.concepto.descripcion;
          bValue = b.concepto.descripcion;
          break;
        case "cantidad":
          aValue = a.concepto.cantidad;
          bValue = b.concepto.cantidad;
          break;
        case "valorUnitario":
          aValue = a.concepto.valorUnitario;
          bValue = b.concepto.valorUnitario;
          break;
        case "importe":
          // Adjust importe based on invoice type
          aValue =
            a.invoiceData.comprobante.tipoComprobante === "E"
              ? -a.concepto.importe
              : a.concepto.importe;
          bValue =
            b.invoiceData.comprobante.tipoComprobante === "E"
              ? -b.concepto.importe
              : b.concepto.importe;
          break;
        case "impuestos":
          // Adjust impuestos based on invoice type
          aValue =
            a.invoiceData.comprobante.tipoComprobante === "E"
              ? -a.concepto.impuestos
              : a.concepto.impuestos;
          bValue =
            b.invoiceData.comprobante.tipoComprobante === "E"
              ? -b.concepto.impuestos
              : b.concepto.impuestos;
          break;
        case "tipo":
          aValue = a.invoiceData.comprobante.tipoComprobante;
          bValue = b.invoiceData.comprobante.tipoComprobante;
          break;
        default:
          aValue = a.invoiceData.fecha;
          bValue = b.invoiceData.fecha;
      }

      // Handle string comparison
      if (typeof aValue === "string" && typeof bValue === "string") {
        return conceptSort.direction === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      // Handle number comparison
      return conceptSort.direction === "asc"
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return allConcepts;
  }, [processedData, conceptSearch, conceptFilter, conceptSort]);

  // Get paginated concepts
  const paginatedConcepts = useMemo(() => {
    const startIndex =
      (conceptPagination.currentPage - 1) * conceptPagination.pageSize;
    return filteredConcepts.slice(
      startIndex,
      startIndex + conceptPagination.pageSize
    );
  }, [filteredConcepts, conceptPagination]);

  // Calculate total pages for concepts
  const totalConceptPages = useMemo(() => {
    return Math.ceil(filteredConcepts.length / conceptPagination.pageSize);
  }, [filteredConcepts.length, conceptPagination.pageSize]);

  // Handle sort change
  const handleSortChange = (key: string, sortType: "invoice" | "concept") => {
    if (sortType === "invoice") {
      setInvoiceSort((prev) => ({
        key,
        direction:
          prev.key === key && prev.direction === "asc" ? "desc" : "asc",
      }));
    } else {
      setConceptSort((prev) => ({
        key,
        direction:
          prev.key === key && prev.direction === "asc" ? "desc" : "asc",
      }));
    }
  };

  // Handle filter change
  const handleFilterChange = (
    key: string,
    value: string | null,
    filterType: "invoice" | "concept"
  ) => {
    if (filterType === "invoice") {
      setInvoiceFilter((prev) => ({
        ...prev,
        [key]: value,
      }));
    } else {
      setConceptFilter((prev) => ({
        ...prev,
        [key]: value,
      }));
    }
  };

  // Change page
  const changePage = (page: number, paginationType: "invoice" | "concept") => {
    if (paginationType === "invoice") {
      setInvoicePagination((prev) => ({
        ...prev,
        currentPage: page,
      }));
    } else {
      setConceptPagination((prev) => ({
        ...prev,
        currentPage: page,
      }));
    }
  };

  // Change page size
  const changePageSize = (
    size: number,
    paginationType: "invoice" | "concept"
  ) => {
    if (paginationType === "invoice") {
      setInvoicePagination((prev) => ({
        ...prev,
        pageSize: size,
        currentPage: 1,
      }));
    } else {
      setConceptPagination((prev) => ({
        ...prev,
        pageSize: size,
        currentPage: 1,
      }));
    }
  };

  // Get page numbers to display
  const getPageNumbers = (
    totalPages: number,
    currentPage: number
  ): number[] => {
    const maxPagesToShow = 5;
    let pages: number[] = [];

    if (totalPages <= maxPagesToShow) {
      // Show all pages
      pages = Array.from({ length: totalPages }, (_, i) => i + 1);
    } else {
      // Always include first and last pages
      pages.push(1);

      // Calculate middle pages
      let startPage = Math.max(2, currentPage - 1);
      let endPage = Math.min(totalPages - 1, currentPage + 1);

      // Adjust if we're near the beginning or end
      if (currentPage <= 2) {
        endPage = 4;
      } else if (currentPage >= totalPages - 1) {
        startPage = totalPages - 3;
      }

      // Add ellipsis if needed
      if (startPage > 2) {
        pages.push(-1); // Use -1 to represent ellipsis
      }

      // Add middle pages
      for (let i = startPage; i <= endPage; i++) {
        pages.push(i);
      }

      // Add ellipsis if needed
      if (endPage < totalPages - 1) {
        pages.push(-2); // Use -2 to represent ellipsis
      }

      // Add last page
      if (totalPages > 1) {
        pages.push(totalPages);
      }
    }

    return pages;
  };

  // Process uploaded files
  const processFiles = (files: File[]) => {
    // Process each file
    toast.promise(
      new Promise<XmlFile[]>((resolve) => {
        const promises = files.map((file) => {
          return new Promise<XmlFile>((resolveFile) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              if (!event.target) return;
              resolveFile({
                name: file.name,
                content: event.target.result as string,
                size: file.size,
                type: file.type,
              });
            };
            reader.readAsText(file);
          });
        });

        // When all files are read
        Promise.all(promises).then((fileDataArray) => {
          setXmlFiles((prev) => [...prev, ...fileDataArray]);
          resolve(fileDataArray);
        });
      }),
      {
        loading: "Cargando archivos XML...",
        success: (data) => `${data.length} archivos XML cargados correctamente`,
        error: "Error al cargar los archivos",
      }
    );
  };

  // Handle file upload
  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target || !e.target.files || e.target.files.length === 0) return;

    const files = Array.from(e.target.files);
    processFiles(files);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Remove a file from the list
  const removeFile = (index: number) => {
    setXmlFiles((prev) => {
      const newFiles = prev.filter((_, i) => i !== index);
      toast(`Archivo "${prev[index].name}" eliminado`, {
        icon: <X className="h-4 w-4 text-red-500" />,
      });
      return newFiles;
    });
  };

  const parseXMLContent = (xmlContent: string): InvoiceDataParsed | null => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "text/xml");

    // Helper function to parse numbers correctly
    const parseNumberSafely = (value: any, defaultValue = 0): number => {
      if (typeof value === "number") return value;
      if (typeof value !== "string" || value.trim() === "") return defaultValue;

      const trimmedValue = value.trim();

      // Handle European format (comma as decimal, possibly periods as thousands separators)
      if (/^-?[\d.,]+$/.test(trimmedValue)) {
        // If it contains a comma, it's likely European format
        if (trimmedValue.includes(",")) {
          // Convert European format to standard format:
          // First remove all periods (thousands separators)
          // Then replace comma with period for decimal point
          const normalized = trimmedValue.replace(/\./g, "").replace(",", ".");

          const result = parseFloat(normalized);
          if (!isNaN(result)) {
            return result;
          }
        }
      }

      // Try standard parsing
      const result = parseFloat(trimmedValue);
      return !isNaN(result) ? result : defaultValue;
    };

    try {
      // Extract main invoice data
      const comprobante = xmlDoc.getElementsByTagName("cfdi:Comprobante")[0];

      if (!comprobante) {
        console.error("Missing required XML elements");
        return null;
      }

      // FIRST: Check for problematic payment vouchers and skip them
      const tipoComprobante =
        comprobante.getAttribute("TipoDeComprobante") || "";
      const moneda = comprobante.getAttribute("Moneda") || "";

      // Check if it's a payment voucher with XXX currency and zero totals
      if (
        tipoComprobante === "P" &&
        comprobante.getAttribute("SubTotal") === "0" &&
        moneda === "XXX" &&
        comprobante.getAttribute("Total") === "0"
      ) {
        // Look for exempt tax factor
        const hasExemptTaxFactor = xmlDoc.querySelector(
          "[TipoFactorP='Exento'], [TipoFactorDR='Exento']"
        );

        // Check for large payment amounts
        const pagos = xmlDoc.getElementsByTagName("pago20:Pagos")[0];
        if (pagos && hasExemptTaxFactor) {
          const doctoRelacionado = xmlDoc.querySelector(
            "pago20:DoctoRelacionado"
          );
          if (doctoRelacionado) {
            const impSaldoAnt = parseNumberSafely(
              doctoRelacionado.getAttribute("ImpSaldoAnt") || "0"
            );
            const impPagado = parseNumberSafely(
              doctoRelacionado.getAttribute("ImpPagado") || "0"
            );

            // If it has large payment amounts and exempt tax factor, skip this file
            if (impSaldoAnt > 100000 && impPagado > 100000) {
              console.warn(
                "Skipping problematic payment XML with exempt tax and large amounts"
              );
              return null;
            }
          }

          // Additional check: Look for TotalTrasladosBaseIVAExento with large values
          const totales = pagos.getElementsByTagName("pago20:Totales")[0];
          if (totales) {
            const exemptBase = parseNumberSafely(
              totales.getAttribute("TotalTrasladosBaseIVAExento") || "0"
            );
            if (exemptBase > 100000) {
              console.warn(
                "Skipping problematic payment XML with large exempt base amount"
              );
              return null;
            }
          }
        }
      }

      const emisor = xmlDoc.getElementsByTagName("cfdi:Emisor")[0];
      const receptor = xmlDoc.getElementsByTagName("cfdi:Receptor")[0];
      const conceptos = xmlDoc.getElementsByTagName("cfdi:Conceptos")[0];
      const timbreFiscal = xmlDoc.getElementsByTagName(
        "tfd:TimbreFiscalDigital"
      )[0];

      if (!emisor || !receptor || !conceptos) {
        console.error("Missing required XML elements");
        return null;
      }

      // Extract main invoice attributes
      const fecha = comprobante.getAttribute("Fecha") || "";
      const serie = comprobante.getAttribute("Serie") || "";
      const folio = comprobante.getAttribute("Folio") || "";
      const tipoCambio = parseNumberSafely(
        comprobante.getAttribute("TipoCambio") || "1",
        1
      );
      const exportacion = comprobante.getAttribute("Exportacion") || "";

      // Check if it's a payment voucher (type P)
      const isPaymentVoucher = tipoComprobante === "P";

      // Initialize variables for amounts
      let totalAmount = 0;
      let subTotalAmount = 0;
      let totalImpuestosTrasladados = 0;

      if (isPaymentVoucher) {
        // Default values from Comprobante
        totalAmount = parseNumberSafely(
          comprobante.getAttribute("Total") || "0"
        );
        subTotalAmount = parseNumberSafely(
          comprobante.getAttribute("SubTotal") || "0"
        );

        // Look for the Pagos element
        const pagos = xmlDoc.getElementsByTagName("pago20:Pagos")[0];
        if (pagos) {
          // First, determine if this is a tax-exempt payment
          // Check for TipoFactorDR="Exento" in any DoctoRelacionado
          let hasExemptTax = false;

          // Look for explicit exempt tax indicators
          const exemptFactorElement = xmlDoc.querySelector(
            "[TipoFactorDR='Exento'], [TipoFactorP='Exento']"
          );
          if (exemptFactorElement) {
            hasExemptTax = true;
          }

          const totales = pagos.getElementsByTagName("pago20:Totales")[0];
          if (totales) {
            // Also check for TotalTrasladosBaseIVAExento attribute
            if (totales.getAttribute("TotalTrasladosBaseIVAExento") !== null) {
              hasExemptTax = true;
            }

            const montoTotalPagos = parseNumberSafely(
              totales.getAttribute("MontoTotalPagos") || "0"
            );
            if (montoTotalPagos > 0) {
              totalAmount = montoTotalPagos;

              if (hasExemptTax) {
                // For tax-exempt payments, subtotal equals total and taxes are 0
                subTotalAmount = totalAmount;
                totalImpuestosTrasladados = 0;
              } else {
                // For payments with tax, look for base and tax amounts
                const baseIVA16 = parseNumberSafely(
                  totales.getAttribute("TotalTrasladosBaseIVA16") || "0"
                );
                const baseIVA8 = parseNumberSafely(
                  totales.getAttribute("TotalTrasladosBaseIVA8") || "0"
                );
                const baseIVA0 = parseNumberSafely(
                  totales.getAttribute("TotalTrasladosBaseIVA0") || "0"
                );
                const totalBase = baseIVA16 + baseIVA8 + baseIVA0;

                // If we found any tax base, use it for subtotal
                if (totalBase > 0) {
                  subTotalAmount = totalBase;
                  // Get tax amounts
                  const impuestoIVA16 = parseNumberSafely(
                    totales.getAttribute("TotalTrasladosImpuestoIVA16") || "0"
                  );
                  const impuestoIVA8 = parseNumberSafely(
                    totales.getAttribute("TotalTrasladosImpuestoIVA8") || "0"
                  );
                  totalImpuestosTrasladados = impuestoIVA16 + impuestoIVA8;
                } else {
                  // No explicit tax base found
                  // Try to check individual payments
                  let foundTaxInfo = false;
                  const pagoElements =
                    pagos.getElementsByTagName("pago20:Pago");
                  for (
                    let i = 0;
                    i < pagoElements.length && !foundTaxInfo;
                    i++
                  ) {
                    const pago = pagoElements[i];
                    const doctoRelacionados = pago.getElementsByTagName(
                      "pago20:DoctoRelacionado"
                    );

                    for (
                      let j = 0;
                      j < doctoRelacionados.length && !foundTaxInfo;
                      j++
                    ) {
                      const docto = doctoRelacionados[j];
                      const impuestosDR =
                        docto.getElementsByTagName("pago20:ImpuestosDR")[0];

                      if (impuestosDR) {
                        const trasladosDR =
                          impuestosDR.getElementsByTagName(
                            "pago20:TrasladosDR"
                          )[0];
                        if (trasladosDR) {
                          const trasladoDRs =
                            trasladosDR.getElementsByTagName(
                              "pago20:TrasladoDR"
                            );
                          for (let k = 0; k < trasladoDRs.length; k++) {
                            const trasladoDR = trasladoDRs[k];
                            const tipoFactorDR =
                              trasladoDR.getAttribute("TipoFactorDR");

                            if (tipoFactorDR === "Tasa") {
                              // Found a tax rate specification
                              const baseDR = parseNumberSafely(
                                trasladoDR.getAttribute("BaseDR") || "0"
                              );
                              const importeDR = parseNumberSafely(
                                trasladoDR.getAttribute("ImporteDR") || "0"
                              );

                              if (baseDR > 0) {
                                subTotalAmount = baseDR;
                                totalImpuestosTrasladados = importeDR;
                                foundTaxInfo = true;
                                break;
                              }
                            }
                          }
                        }
                      }
                    }
                  }

                  // If we still have no tax info, assume subtotal = total, no taxes
                  if (!foundTaxInfo) {
                    subTotalAmount = totalAmount;
                    totalImpuestosTrasladados = 0;
                  }
                }
              }
            }
          } else {
            // If no Totales element, calculate from Pago elements
            const pagoElements = pagos.getElementsByTagName("pago20:Pago");
            let totalMonto = 0;

            for (let i = 0; i < pagoElements.length; i++) {
              const pago = pagoElements[i];
              const montoAttr = pago.getAttribute("Monto");
              totalMonto += parseNumberSafely(montoAttr || "0");
            }

            if (totalMonto > 0) {
              totalAmount = totalMonto;

              if (hasExemptTax) {
                // For tax-exempt payments, subtotal equals total and taxes are 0
                subTotalAmount = totalAmount;
                totalImpuestosTrasladados = 0;
              } else {
                // Try to extract tax information from ImpuestosP
                let totalBase = 0;
                let totalTax = 0;
                let foundTaxInfo = false;

                for (let i = 0; i < pagoElements.length; i++) {
                  const pago = pagoElements[i];
                  const impuestosP =
                    pago.getElementsByTagName("pago20:ImpuestosP")[0];

                  if (impuestosP) {
                    const trasladosP =
                      impuestosP.getElementsByTagName("pago20:TrasladosP")[0];
                    if (trasladosP) {
                      const trasladoElements =
                        trasladosP.getElementsByTagName("pago20:TrasladoP");
                      for (let j = 0; j < trasladoElements.length; j++) {
                        const traslado = trasladoElements[j];
                        const tipoFactorP =
                          traslado.getAttribute("TipoFactorP");

                        if (tipoFactorP !== "Exento") {
                          foundTaxInfo = true;
                          const baseP = parseNumberSafely(
                            traslado.getAttribute("BaseP") || "0"
                          );
                          const importeP = parseNumberSafely(
                            traslado.getAttribute("ImporteP") || "0"
                          );
                          totalBase += baseP;
                          totalTax += importeP;
                        }
                      }
                    }
                  }
                }

                if (foundTaxInfo && totalBase > 0) {
                  subTotalAmount = totalBase;
                  totalImpuestosTrasladados = totalTax;
                } else {
                  // No tax info found, assume subtotal = total, no taxes
                  subTotalAmount = totalAmount;
                  totalImpuestosTrasladados = 0;
                }
              }
            }
          }

          // Final safety checks for payment vouchers
          if (hasExemptTax) {
            // For tax-exempt payments, always ensure taxes are 0
            totalImpuestosTrasladados = 0;
            subTotalAmount = totalAmount;
          }

          // If the difference between subtotal and total is very small, assume no taxes
          if (Math.abs(subTotalAmount - totalAmount) < 0.01) {
            totalImpuestosTrasladados = 0;
          }
        }
      } else {
        // Regular invoice (not payment)
        totalAmount = parseNumberSafely(
          comprobante.getAttribute("Total") || "0"
        );
        subTotalAmount = parseNumberSafely(
          comprobante.getAttribute("SubTotal") || "0"
        );

        // Calculate tax information from impuestos node
        const impuestosNode = xmlDoc.getElementsByTagName("cfdi:Impuestos")[0];
        if (impuestosNode) {
          const totalImpTransAttr = impuestosNode.getAttribute(
            "TotalImpuestosTrasladados"
          );
          if (totalImpTransAttr) {
            totalImpuestosTrasladados = parseNumberSafely(totalImpTransAttr);
          } else {
            // If not specified directly, use traslados if available
            const trasladosNodes =
              impuestosNode.getElementsByTagName("cfdi:Traslados")[0];
            if (trasladosNodes) {
              const trasladoElements =
                trasladosNodes.getElementsByTagName("cfdi:Traslado");
              for (let i = 0; i < trasladoElements.length; i++) {
                const traslado = trasladoElements[i];
                // Check if this is an exempt tax
                const tipoFactor = traslado.getAttribute("TipoFactor") || "";
                if (tipoFactor !== "Exento") {
                  totalImpuestosTrasladados += parseNumberSafely(
                    traslado.getAttribute("Importe") || "0"
                  );
                }
              }
            }
          }
        }

        // Round values
        totalAmount = roundToTwo(totalAmount);
        subTotalAmount = roundToTwo(subTotalAmount);
        totalImpuestosTrasladados = roundToTwo(totalImpuestosTrasladados);
      }

      // If tax information is still not available, calculate from total and subtotal
      // Only if we don't have exempt taxes
      const hasExemptTax = xmlDoc.querySelector(
        "[TipoFactor='Exento'], [TipoFactorP='Exento'], [TipoFactorDR='Exento']"
      );

      if (
        totalImpuestosTrasladados === 0 &&
        totalAmount > 0 &&
        subTotalAmount > 0 &&
        !hasExemptTax
      ) {
        totalImpuestosTrasladados = roundToTwo(totalAmount - subTotalAmount);
      }

      // Verify the calculation: subtotal + taxes = total
      const calculatedTotal = roundToTwo(
        subTotalAmount + totalImpuestosTrasladados
      );
      if (Math.abs(calculatedTotal - totalAmount) > 0.1 && !hasExemptTax) {
        console.warn("Warning: Tax calculation discrepancy detected", {
          subTotal: subTotalAmount,
          totalImpuestosTrasladados,
          total: totalAmount,
          calculatedTotal,
          difference: Math.abs(calculatedTotal - totalAmount),
        });

        // For non-payment CFDIs, if the difference is too large, just calculate taxes from subtotal and total
        if (!isPaymentVoucher && !hasExemptTax) {
          totalImpuestosTrasladados = roundToTwo(totalAmount - subTotalAmount);
        }
      }

      // Extract emisor info
      const emisorRfc = emisor.getAttribute("Rfc") || "";
      const emisorNombre = emisor.getAttribute("Nombre") || "";
      const regimenFiscal = emisor.getAttribute("RegimenFiscal") || "";

      // Extract receptor info
      const receptorRfc = receptor.getAttribute("Rfc") || "";
      const receptorNombre = receptor.getAttribute("Nombre") || "";
      const usoCFDI = receptor.getAttribute("UsoCFDI") || "";
      const domicilioFiscalReceptor =
        receptor.getAttribute("DomicilioFiscalReceptor") || "";

      // Extract UUID
      const uuid = timbreFiscal ? timbreFiscal.getAttribute("UUID") || "" : "";
      const fechaTimbrado = timbreFiscal
        ? timbreFiscal.getAttribute("FechaTimbrado") || ""
        : "";

      // Process concepts
      const conceptsArray: Concepto[] = [];
      const conceptElements = conceptos.getElementsByTagName("cfdi:Concepto");
      for (let i = 0; i < conceptElements.length; i++) {
        const concepto = conceptElements[i];
        const descripcion = concepto.getAttribute("Descripcion") || "";
        const valorUnitario = parseNumberSafely(
          concepto.getAttribute("ValorUnitario") || "0"
        );
        const importe = parseNumberSafely(
          concepto.getAttribute("Importe") || "0"
        );
        const cantidad = parseNumberSafely(
          concepto.getAttribute("Cantidad") || "0"
        );
        const claveProdServ = concepto.getAttribute("ClaveProdServ") || "";
        const claveUnidad = concepto.getAttribute("ClaveUnidad") || "";
        const unidad = concepto.getAttribute("Unidad") || "";

        // Process taxes for this concept
        let impuestoImporte = 0;
        const impuestosNode =
          concepto.getElementsByTagName("cfdi:Impuestos")[0];
        if (impuestosNode) {
          const traslados = impuestosNode.getElementsByTagName("cfdi:Traslado");
          for (let j = 0; j < traslados.length; j++) {
            const tipoFactor = traslados[j].getAttribute("TipoFactor") || "";
            if (tipoFactor !== "Exento") {
              impuestoImporte += parseNumberSafely(
                traslados[j].getAttribute("Importe") || "0"
              );
            }
          }
        }

        conceptsArray.push({
          descripcion,
          valorUnitario,
          importe,
          cantidad,
          impuestos: impuestoImporte,
          claveProdServ,
          claveUnidad,
          unidad,
        });
      }

      // For payment vouchers, if we have no concepts with tax info but we know the total tax
      if (
        isPaymentVoucher &&
        conceptsArray.length > 0 &&
        conceptsArray.every((c) => c.impuestos === 0) &&
        totalImpuestosTrasladados > 0
      ) {
        // Distribute taxes proportionally across concepts or assign to the first concept
        if (conceptsArray.length === 1) {
          conceptsArray[0].impuestos = totalImpuestosTrasladados;
        } else {
          // For multiple concepts in a payment, we can't reliably distribute taxes
          // Just add the tax info to the first "Pago" concept
          const pagoIndex = conceptsArray.findIndex(
            (c) => c.descripcion === "Pago"
          );
          if (pagoIndex >= 0) {
            conceptsArray[pagoIndex].impuestos = totalImpuestosTrasladados;
          } else {
            conceptsArray[0].impuestos = totalImpuestosTrasladados;
          }
        }
      }

      // Process global taxes
      const traslados: Array<{
        impuesto: string;
        importe: number;
        tasa: number;
        tipoFactor: string;
      }> = [];

      // Create base invoice data
      const parsedInvoice: InvoiceDataParsed = {
        uuid,
        fecha,
        fechaTimbrado,
        serie,
        folio,
        emisor: {
          rfc: emisorRfc,
          nombre: emisorNombre,
          regimenFiscal,
        },
        receptor: {
          rfc: receptorRfc,
          nombre: receptorNombre,
          usoCFDI,
          domicilioFiscalReceptor,
        },
        comprobante: {
          total: totalAmount,
          subTotal: subTotalAmount,
          formaPago: comprobante.getAttribute("FormaPago") || "",
          metodoPago: comprobante.getAttribute("MetodoPago") || "",
          tipoComprobante,
          moneda,
          tipoCambio,
          exportacion,
        },
        conceptos: conceptsArray,
        impuestos: {
          totalImpuestosTrasladados,
          traslados,
        },
      };

      // Add display values based on tipo comprobante
      return calculateDisplayValues(parsedInvoice);
    } catch (error) {
      console.error("Error parsing XML:", error);
      return null;
    }
  };

  // Process all XML files
  const processXmlFiles = () => {
    if (xmlFiles.length === 0) {
      toast.error("Por favor, cargue al menos un archivo XML.");
      return;
    }

    // Validate inputs before processing
    if (!validateInputs()) {
      toast.error(
        "Por favor, corrija los errores en el formulario antes de continuar."
      );
      return;
    }

    setIsProcessing(true);
    setProcessingProgress(0);

    toast.promise(
      (async () => {
        // Process each XML file with progress updates
        const processedInvoices: ProcessedInvoice[] = [];
        const failedFiles: string[] = [];

        for (let i = 0; i < xmlFiles.length; i++) {
          const file = xmlFiles[i];
          const parsedData = parseXMLContent(file.content);

          if (parsedData) {
            processedInvoices.push({
              fileName: file.name,
              data: parsedData,
            });
          } else {
            failedFiles.push(file.name);
          }

          // Update progress
          setProcessingProgress(Math.round(((i + 1) / xmlFiles.length) * 100));

          // Small delay to show progress
          if (i < xmlFiles.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        // Calculate totals and organize data using the new accounting logic
        let totalAmount = 0;
        let totalTaxes = 0;
        let totalSubtotal = 0;
        let ingresosTotal = 0;
        let egresosTotal = 0;
        let pagosTotal = 0;
        let ingresosTaxes = 0;
        let egresosTaxes = 0;
        let pagosTaxes = 0;
        let ingresosSubtotal = 0;
        let egresosSubtotal = 0;
        let pagosSubtotal = 0;
        let ingresosCount = 0;
        let egresosCount = 0;
        let pagosCount = 0;

        // Get date range
        const dates = processedInvoices.map((invoice) =>
          new Date(invoice.data.fecha).getTime()
        );
        const minDate = new Date(Math.min(...dates))
          .toISOString()
          .split("T")[0];
        const maxDate = new Date(Math.max(...dates))
          .toISOString()
          .split("T")[0];

        // Initialize data aggregations
        const byMonth: Record<string, MonthlySummary> = {};
        const byTipoComprobante: Record<string, TypeSummary> = {};

        processedInvoices.forEach((invoice) => {
          const tipo = invoice.data.comprobante.tipoComprobante;
          const isEgreso = tipo === "E";
          const isPago = tipo === "P";
          const isIngreso = tipo === "I";

          // Ensure consistent calculations between total, subtotal, and taxes
          const invoiceTotal = roundToTwo(invoice.data.comprobante.total);
          const invoiceSubtotal = roundToTwo(invoice.data.comprobante.subTotal);
          let invoiceTaxes = roundToTwo(
            invoice.data.impuestos.totalImpuestosTrasladados
          );

          // For consistency: if there's a discrepancy, recalculate taxes as the difference
          if (Math.abs(invoiceSubtotal + invoiceTaxes - invoiceTotal) > 0.1) {
            invoiceTaxes = roundToTwo(invoiceTotal - invoiceSubtotal);
          }

          // Apply sign based on invoice type
          const signMultiplier = isEgreso ? -1 : 1;
          const amountValue = roundToTwo(invoiceTotal * signMultiplier);
          const subtotalValue = roundToTwo(invoiceSubtotal * signMultiplier);
          const taxesValue = roundToTwo(invoiceTaxes * signMultiplier);

          // Add to global totals
          totalAmount = roundToTwo(totalAmount + amountValue);
          totalTaxes = roundToTwo(totalTaxes + taxesValue);
          totalSubtotal = roundToTwo(totalSubtotal + subtotalValue);

          // Track by invoice type
          if (isIngreso) {
            ingresosTotal = roundToTwo(ingresosTotal + amountValue);
            ingresosTaxes = roundToTwo(ingresosTaxes + taxesValue);
            ingresosSubtotal = roundToTwo(ingresosSubtotal + subtotalValue);
            ingresosCount++;
          } else if (isEgreso) {
            egresosTotal = roundToTwo(egresosTotal + Math.abs(amountValue)); // Store as positive for display purposes
            egresosTaxes = roundToTwo(egresosTaxes + Math.abs(taxesValue));
            egresosSubtotal = roundToTwo(
              egresosSubtotal + Math.abs(subtotalValue)
            );
            egresosCount++;
          } else if (isPago) {
            pagosTotal = roundToTwo(pagosTotal + amountValue);
            pagosTaxes = roundToTwo(pagosTaxes + taxesValue);
            pagosSubtotal = roundToTwo(pagosSubtotal + subtotalValue);
            pagosCount++;
          }

          // Aggregate by month
          const date = new Date(invoice.data.fecha);
          const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1)
            .toString()
            .padStart(2, "0")}`;

          if (!byMonth[monthKey]) {
            byMonth[monthKey] = {
              count: 0,
              total: 0,
              taxes: 0,
              subtotal: 0,
              ingresos: 0,
              egresos: 0,
              pagos: 0,
              ingresoCount: 0,
              egresoCount: 0,
              pagoCount: 0,
              otherCount: 0,
            };
          }

          byMonth[monthKey].count += 1;
          byMonth[monthKey].total = roundToTwo(
            byMonth[monthKey].total + amountValue
          );
          byMonth[monthKey].taxes = roundToTwo(
            byMonth[monthKey].taxes + taxesValue
          );
          byMonth[monthKey].subtotal = roundToTwo(
            byMonth[monthKey].subtotal + subtotalValue
          );

          // Track by invoice type within month
          if (isIngreso) {
            byMonth[monthKey].ingresos = roundToTwo(
              byMonth[monthKey].ingresos + amountValue
            );
            byMonth[monthKey].ingresoCount += 1;
          } else if (isEgreso) {
            byMonth[monthKey].egresos = roundToTwo(
              byMonth[monthKey].egresos + Math.abs(amountValue)
            ); // Store as positive for display
            byMonth[monthKey].egresoCount += 1;
          } else if (isPago) {
            byMonth[monthKey].pagos = roundToTwo(
              byMonth[monthKey].pagos + amountValue
            );
            byMonth[monthKey].pagoCount += 1;
          } else {
            byMonth[monthKey].otherCount += 1;
          }

          // Aggregate by invoice type
          if (!byTipoComprobante[tipo]) {
            byTipoComprobante[tipo] = {
              count: 0,
              total: 0,
              taxes: 0,
              subtotal: 0,
            };
          }

          byTipoComprobante[tipo].count += 1;
          byTipoComprobante[tipo].total = roundToTwo(
            byTipoComprobante[tipo].total + amountValue
          );
          byTipoComprobante[tipo].taxes = roundToTwo(
            byTipoComprobante[tipo].taxes + taxesValue
          );
          byTipoComprobante[tipo].subtotal = roundToTwo(
            byTipoComprobante[tipo].subtotal + subtotalValue
          );
        });

        // Verify all calculations
        // Calculate formula: (ingresos + pagos) - egresos = total
        const calculatedTotal = roundToTwo(
          ingresosTotal + pagosTotal - egresosTotal
        );

        // Check if our calculation matches the summed total
        if (Math.abs(calculatedTotal - totalAmount) > 0.1) {
          console.warn("Warning: Global calculation discrepancy detected", {
            ingresosTotal,
            egresosTotal,
            pagosTotal,
            calculated: calculatedTotal,
            totalAmount,
            difference: Math.abs(calculatedTotal - totalAmount),
          });

          // Adjust the total to match the calculation for consistency
          totalAmount = calculatedTotal;
        }

        // Verify tax calculation: totalSubtotal + totalTaxes = totalAmount
        const calculatedTotalWithTax = roundToTwo(totalSubtotal + totalTaxes);

        if (Math.abs(calculatedTotalWithTax - totalAmount) > 0.1) {
          console.warn("Warning: Tax calculation discrepancy detected", {
            totalSubtotal,
            totalTaxes,
            calculated: calculatedTotalWithTax,
            totalAmount,
            difference: Math.abs(calculatedTotalWithTax - totalAmount),
          });

          // Adjust taxes to match total - subtotal
          totalTaxes = roundToTwo(totalAmount - totalSubtotal);
        }

        // Set the processed data
        setProcessedData({
          invoices: processedInvoices,
          summary: {
            totalAmount,
            totalTaxes,
            totalSubtotal,
            invoiceCount: processedInvoices.length,
            ingresosCount,
            egresosCount,
            pagosCount,
            ingresosTotal,
            egresosTotal,
            pagosTotal,
            byMonth,
            byTipoComprobante,
            dateRange: {
              minDate,
              maxDate,
            },
          },
        });

        // Set pagination values
        setInvoicePagination({
          currentPage: 1,
          pageSize: 10,
          totalItems: processedInvoices.length,
        });

        // Calculate total concepts
        const totalConcepts = processedInvoices.reduce(
          (total, invoice) => total + invoice.data.conceptos.length,
          0
        );

        setConceptPagination({
          currentPage: 1,
          pageSize: 10,
          totalItems: totalConcepts,
        });

        // Move to results tab
        setActiveTab("results");
        setIsProcessing(false);

        return {
          processed: processedInvoices.length,
          failed: failedFiles,
          totalAmount: formatCurrency(totalAmount),
        };
      })(),
      {
        loading: "Procesando archivos XML...",
        success: ({ processed, failed, totalAmount }) => {
          if (failed.length > 0) {
            return `Procesados ${processed} archivos. ${failed.length} archivos con errores. Total: ${totalAmount}`;
          }
          return `Procesados ${processed} archivos correctamente. Total: ${totalAmount}`;
        },
        error: "Error al procesar los archivos XML",
      }
    );
  };

  // Generate XLSX file
  const generateExcel = () => {
    if (!processedData) return;

    toast.promise(
      (async () => {
        // Create workbook
        const wb = XLSX.utils.book_new();

        // Create summary worksheet with type assertions to fix TS errors
        const summaryData: any[][] = [
          ["Reporte de Facturas CFDI"],
          ["Fecha de generación", new Date().toLocaleString("es-MX")],
          [
            "Período del reporte",
            `${processedData.summary.dateRange.minDate} al ${processedData.summary.dateRange.maxDate}`,
          ],
          [""],
          ["Datos de la Empresa"],
          ["Denominación/Razón Social", invoiceData.empresaNombre],
          ["Nombre Comercial", invoiceData.nombreComercial],
          ["RFC", invoiceData.rfc],
          ["Domicilio Fiscal", invoiceData.domicilioFiscal],
          [
            "Régimen Fiscal",
            `${invoiceData.regimenFiscal} - ${getRegimenFiscalText(
              invoiceData.regimenFiscal
            )}`,
          ],
          [""],
          ["Resumen de Facturas"],
          ["Total de Facturas", processedData.summary.invoiceCount],
          ["Facturas de Ingreso", processedData.summary.ingresosCount],
          ["Facturas de Egreso", processedData.summary.egresosCount],
          ["Comprobantes de Pago", processedData.summary.pagosCount],
          [""],
          ["Montos Totales"],
          ["Total de Ingresos", processedData.summary.ingresosTotal],
          ["Total de Egresos", processedData.summary.egresosTotal],
          ["Total de Pagos", processedData.summary.pagosTotal],
          [""],
          ["Balance Final"],
          ["Subtotal", processedData.summary.totalSubtotal],
          ["Impuestos", processedData.summary.totalTaxes],
          ["Total", processedData.summary.totalAmount],
        ];

        const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);

        // Set some column widths
        const wscols = [{ wch: 30 }, { wch: 50 }];
        summaryWs["!cols"] = wscols;

        XLSX.utils.book_append_sheet(wb, summaryWs, "Resumen");

        // Monthly data
        if (processedData.summary.byMonth) {
          const monthData: any[][] = [
            [
              "Mes",
              "Cantidad de Facturas",
              "Ingresos (I)",
              "Egresos (E)",
              "Pagos (P)",
              "Impuestos",
              "Total",
            ],
          ];

          // Sort months chronologically
          const sortedMonths = Object.keys(
            processedData.summary.byMonth
          ).sort();

          for (const month of sortedMonths) {
            const [year, monthNum] = month.split("-");
            const monthName = getMonthName(monthNum);
            const data = processedData.summary.byMonth[month];

            // Pass numbers directly for Excel
            monthData.push([
              `${monthName} ${year}`,
              data.count,
              data.ingresos,
              data.egresos,
              data.pagos,
              data.taxes,
              data.total,
            ]);
          }

          const monthWs = XLSX.utils.aoa_to_sheet(monthData);

          // Set column widths
          const monthCols = [
            { wch: 15 }, // Mes
            { wch: 12 }, // Cantidad
            { wch: 15 }, // Ingresos
            { wch: 15 }, // Egresos
            { wch: 15 }, // Pagos
            { wch: 15 }, // Impuestos
            { wch: 15 }, // Total
          ];
          monthWs["!cols"] = monthCols;

          XLSX.utils.book_append_sheet(wb, monthWs, "Por Mes");
        }

        // Invoice type data
        if (processedData.summary.byTipoComprobante) {
          const tipoData: any[][] = [
            [
              "Tipo de Comprobante",
              "Cantidad de Facturas",
              "Subtotal",
              "Impuestos",
              "Total",
            ],
          ];

          for (const [tipo, data] of Object.entries(
            processedData.summary.byTipoComprobante
          )) {
            tipoData.push([
              `${getTipoComprobanteText(tipo)} (${tipo})`,
              data.count,
              data.subtotal,
              data.taxes,
              data.total,
            ]);
          }

          const tipoWs = XLSX.utils.aoa_to_sheet(tipoData);

          // Set column widths
          const tipoCols = [
            { wch: 25 }, // Tipo de Comprobante
            { wch: 15 }, // Cantidad
            { wch: 15 }, // Subtotal
            { wch: 15 }, // Impuestos
            { wch: 15 }, // Total
          ];
          tipoWs["!cols"] = tipoCols;

          XLSX.utils.book_append_sheet(wb, tipoWs, "Por Tipo");
        }

        // Create detailed invoice worksheet
        const detailsData: any[][] = [
          [
            "UUID",
            "Folio",
            "Serie",
            "Fecha",
            "Emisor",
            "RFC Emisor",
            "Receptor",
            "RFC Receptor",
            "Tipo",
            "Forma de Pago",
            "Método de Pago",
            "Uso CFDI",
            "Subtotal",
            "Impuestos",
            "Total",
          ],
        ];

        // Sort invoices by date for the detailed report
        const sortedInvoices = [...processedData.invoices].sort(
          (a, b) =>
            new Date(a.data.fecha).getTime() - new Date(b.data.fecha).getTime()
        );

        sortedInvoices.forEach((invoice) => {
          const tipo = invoice.data.comprobante.tipoComprobante;
          const isEgreso = tipo === "E";

          const subtotal = isEgreso
            ? -Math.abs(invoice.data.comprobante.subTotal)
            : invoice.data.comprobante.subTotal;

          const impuestos = isEgreso
            ? -Math.abs(invoice.data.impuestos.totalImpuestosTrasladados)
            : invoice.data.impuestos.totalImpuestosTrasladados;

          const total = isEgreso
            ? -Math.abs(invoice.data.comprobante.total)
            : invoice.data.comprobante.total;

          detailsData.push([
            invoice.data.uuid,
            invoice.data.folio || "",
            invoice.data.serie || "",
            invoice.data.fecha,
            invoice.data.emisor.nombre,
            invoice.data.emisor.rfc,
            invoice.data.receptor.nombre,
            invoice.data.receptor.rfc,
            getTipoComprobanteText(tipo),
            getFormaPagoText(invoice.data.comprobante.formaPago),
            getMetodoPagoText(invoice.data.comprobante.metodoPago),
            getUsoCFDIText(invoice.data.receptor.usoCFDI),
            subtotal,
            impuestos,
            total,
          ]);
        });

        const detailsWs = XLSX.utils.aoa_to_sheet(detailsData);
        XLSX.utils.book_append_sheet(wb, detailsWs, "Facturas");

        // Create concepts worksheet
        const conceptsData: any[][] = [
          [
            "UUID",
            "Fecha",
            "Tipo",
            "Clave Prod/Serv",
            "Clave Unidad",
            "Unidad",
            "Descripción",
            "Cantidad",
            "Valor Unitario",
            "Importe",
            "Impuestos",
          ],
        ];

        processedData.invoices.forEach((invoice) => {
          const tipo = invoice.data.comprobante.tipoComprobante;
          const isEgreso = tipo === "E";

          invoice.data.conceptos.forEach((concepto) => {
            const importe = isEgreso
              ? -Math.abs(concepto.importe)
              : concepto.importe;

            const impuestos = isEgreso
              ? -Math.abs(concepto.impuestos)
              : concepto.impuestos;

            conceptsData.push([
              invoice.data.uuid,
              invoice.data.fecha,
              getTipoComprobanteText(tipo),
              concepto.claveProdServ || "",
              concepto.claveUnidad || "",
              concepto.unidad || "",
              concepto.descripcion,
              concepto.cantidad,
              concepto.valorUnitario,
              importe,
              impuestos,
            ]);
          });
        });

        const conceptsWs = XLSX.utils.aoa_to_sheet(conceptsData);
        XLSX.utils.book_append_sheet(wb, conceptsWs, "Conceptos");

        // Save file
        const fileName = `Reporte_Facturas_CFDI_${invoiceData.empresaNombre}.xlsx`;
        XLSX.writeFile(wb, fileName);

        await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay for animation

        return fileName;
      })(),
      {
        loading: "Generando archivo Excel...",
        success: (fileName) =>
          `Archivo Excel "${fileName}" generado correctamente`,
        error: "Error al generar el archivo Excel",
      }
    );
  };

  // Generate PDF report
  const generatePDF = () => {
    if (!processedData) return;

    toast.promise(
      (async () => {
        const doc = new jsPDF();
        let yPos = 20;

        // Helper function to add a title
        const addTitle = (text: string, y: number): number => {
          doc.setFontSize(18);
          doc.setTextColor(0, 51, 102); // Dark blue
          doc.setFont("helvetica", "bold");
          doc.text(text, 14, y);
          return y + 10;
        };

        // Helper function to add a section title
        const addSectionTitle = (text: string, y: number): number => {
          doc.setFontSize(14);
          doc.setTextColor(0, 51, 102);
          doc.setFont("helvetica", "bold");
          doc.text(text, 14, y);
          return y + 7;
        };

        // Helper function to add a label-value pair
        const addLabelValue = (
          label: string,
          value: string,
          y: number
        ): number => {
          doc.setFontSize(10);
          doc.setTextColor(60, 60, 60);
          doc.setFont("helvetica", "bold");
          doc.text(label, 14, y);
          doc.setFont("helvetica", "normal");
          doc.text(value, 70, y);
          return y + 5;
        };

        // Add header
        doc.setFillColor(240, 240, 240);
        doc.rect(0, 0, doc.internal.pageSize.width, 40, "F");

        doc.setDrawColor(0, 51, 102);
        doc.setLineWidth(0.5);
        doc.line(0, 40, doc.internal.pageSize.width, 40);

        // Add title and date
        yPos = addTitle("Reporte de Facturas CFDI", yPos);

        doc.setFontSize(10);
        doc.setTextColor(100, 100, 100);
        doc.setFont("helvetica", "normal");
        doc.text(
          `Generado el: ${new Date().toLocaleString("es-MX")}`,
          14,
          yPos
        );
        yPos += 6;

        doc.text(
          `Período del reporte: ${processedData.summary.dateRange.minDate} al ${processedData.summary.dateRange.maxDate}`,
          14,
          yPos
        );
        yPos += 15;

        // Add company info
        yPos = addSectionTitle("Datos de la Empresa", yPos);
        yPos = addLabelValue(
          "Denominación/Razón Social:",
          invoiceData.empresaNombre,
          yPos
        );
        yPos = addLabelValue(
          "Nombre Comercial:",
          invoiceData.nombreComercial,
          yPos
        );
        yPos = addLabelValue("RFC:", invoiceData.rfc, yPos);
        yPos = addLabelValue("Domicilio:", invoiceData.domicilioFiscal, yPos);
        yPos = addLabelValue(
          "Régimen Fiscal:",
          `${invoiceData.regimenFiscal} - ${getRegimenFiscalText(
            invoiceData.regimenFiscal
          )}`,
          yPos
        );
        yPos += 5;

        // Add summary
        yPos = addSectionTitle("Resumen", yPos);
        yPos = addLabelValue(
          "Total de Facturas:",
          processedData.summary.invoiceCount.toString(),
          yPos
        );
        yPos = addLabelValue(
          "Facturas de Ingreso:",
          processedData.summary.ingresosCount.toString(),
          yPos
        );
        yPos = addLabelValue(
          "Facturas de Egreso:",
          processedData.summary.egresosCount.toString(),
          yPos
        );
        yPos = addLabelValue(
          "Comprobantes de Pago:",
          processedData.summary.pagosCount.toString(),
          yPos
        );
        yPos += 5;

        yPos = addLabelValue(
          "Total de Ingresos:",
          formatCurrency(processedData.summary.ingresosTotal),
          yPos
        );
        yPos = addLabelValue(
          "Total de Egresos:",
          formatCurrency(processedData.summary.egresosTotal),
          yPos
        );
        yPos = addLabelValue(
          "Total de Pagos:",
          formatCurrency(processedData.summary.pagosTotal),
          yPos
        );
        yPos += 5;

        yPos = addLabelValue(
          "Subtotal:",
          formatCurrency(processedData.summary.totalSubtotal),
          yPos
        );
        yPos = addLabelValue(
          "Impuestos:",
          formatCurrency(processedData.summary.totalTaxes),
          yPos
        );
        yPos = addLabelValue(
          "Total:",
          formatCurrency(processedData.summary.totalAmount),
          yPos
        );
        yPos += 10;

        // Add invoice table
        yPos = addSectionTitle("Detalle de Facturas", yPos);
        yPos += 5;

        // Sort invoices by date for the report
        const sortedInvoices = [...processedData.invoices].sort(
          (a, b) =>
            new Date(a.data.fecha).getTime() - new Date(b.data.fecha).getTime()
        );

        const invoiceTableData = sortedInvoices.map((invoice) => {
          const tipo = invoice.data.comprobante.tipoComprobante;
          const tipoText = getTipoComprobanteText(tipo);
          const isEgreso = tipo === "E";

          const subtotal = isEgreso
            ? -Math.abs(invoice.data.comprobante.subTotal)
            : invoice.data.comprobante.subTotal;

          const impuestos = isEgreso
            ? -Math.abs(invoice.data.impuestos.totalImpuestosTrasladados)
            : invoice.data.impuestos.totalImpuestosTrasladados;

          const total = isEgreso
            ? -Math.abs(invoice.data.comprobante.total)
            : invoice.data.comprobante.total;

          return [
            invoice.data.uuid.substring(0, 8) + "...",
            invoice.data.serie
              ? `${invoice.data.serie}-${invoice.data.folio}`
              : invoice.data.folio || "",
            new Date(invoice.data.fecha).toLocaleDateString("es-MX"),
            invoice.data.emisor.nombre.substring(0, 20) +
              (invoice.data.emisor.nombre.length > 20 ? "..." : ""),
            tipoText,
            formatCurrency(subtotal),
            formatCurrency(impuestos),
            formatCurrency(total),
          ];
        });

        autoTable(doc, {
          startY: yPos,
          head: [
            [
              "UUID",
              "Folio",
              "Fecha",
              "Emisor",
              "Tipo",
              "Subtotal",
              "Impuestos",
              "Total",
            ],
          ],
          body: invoiceTableData,
          theme: "grid",
          styles: {
            fontSize: 8,
            cellPadding: 2,
            lineColor: [200, 200, 200],
            lineWidth: 0.1,
          },
          headStyles: {
            fillColor: [0, 51, 102],
            textColor: [255, 255, 255],
            fontStyle: "bold",
          },
          alternateRowStyles: {
            fillColor: [240, 240, 240],
          },
          columnStyles: {
            5: { halign: "right" },
            6: { halign: "right" },
            7: { halign: "right" },
          },
        });

        // Add concept details in a new page
        doc.addPage();
        yPos = 20;

        yPos = addTitle("Detalle de Conceptos", yPos);
        yPos += 10;

        const conceptsTableData: Array<Array<string>> = [];

        sortedInvoices.forEach((invoice) => {
          const tipo = invoice.data.comprobante.tipoComprobante;
          const isEgreso = tipo === "E";

          invoice.data.conceptos.forEach((concepto) => {
            const importe = isEgreso
              ? -Math.abs(concepto.importe)
              : concepto.importe;

            const impuestos = isEgreso
              ? -Math.abs(concepto.impuestos)
              : concepto.impuestos;

            conceptsTableData.push([
              invoice.data.uuid.substring(0, 8) + "...",
              new Date(invoice.data.fecha).toLocaleDateString("es-MX"),
              getTipoComprobanteText(tipo),
              concepto.descripcion.substring(0, 40) +
                (concepto.descripcion.length > 40 ? "..." : ""),
              concepto.cantidad.toString(),
              formatCurrency(concepto.valorUnitario),
              formatCurrency(importe),
              formatCurrency(impuestos),
            ]);
          });
        });

        autoTable(doc, {
          startY: yPos,
          head: [
            [
              "UUID",
              "Fecha",
              "Tipo",
              "Descripción",
              "Cantidad",
              "Valor Unit.",
              "Importe",
              "Impuestos",
            ],
          ],
          body: conceptsTableData,
          theme: "grid",
          styles: {
            fontSize: 8,
            cellPadding: 2,
            lineColor: [200, 200, 200],
            lineWidth: 0.1,
          },
          headStyles: {
            fillColor: [0, 51, 102],
            textColor: [255, 255, 255],
            fontStyle: "bold",
          },
          alternateRowStyles: {
            fillColor: [240, 240, 240],
          },
          columnStyles: {
            4: { halign: "right" },
            5: { halign: "right" },
            6: { halign: "right" },
            7: { halign: "right" },
          },
        });

        // Monthly summary on a separate page
        if (
          processedData.summary.byMonth &&
          Object.keys(processedData.summary.byMonth).length > 0
        ) {
          doc.addPage();
          yPos = 20;

          yPos = addTitle("Resumen por Mes", yPos);
          yPos += 10;

          const monthlyData: Array<Array<string>> = [];
          const sortedMonths = Object.keys(
            processedData.summary.byMonth
          ).sort();

          for (const month of sortedMonths) {
            const [year, monthNum] = month.split("-");
            const monthName = getMonthName(monthNum);
            const data = processedData.summary.byMonth[month];

            monthlyData.push([
              `${monthName} ${year}`,
              data.count.toString(),
              `${data.ingresoCount} / ${formatCurrency(data.ingresos)}`,
              `${data.egresoCount} / ${formatCurrency(data.egresos)}`,
              `${data.pagoCount} / ${formatCurrency(data.pagos)}`,
              formatCurrency(data.taxes),
              formatCurrency(data.total),
            ]);
          }

          autoTable(doc, {
            startY: yPos,
            head: [
              [
                "Mes",
                "Facturas",
                "Ingresos (I)",
                "Egresos (E)",
                "Pagos (P)",
                "Impuestos",
                "Total",
              ],
            ],
            body: monthlyData,
            theme: "grid",
            styles: {
              fontSize: 8,
              cellPadding: 3,
              lineColor: [200, 200, 200],
              lineWidth: 0.1,
            },
            headStyles: {
              fillColor: [0, 51, 102],
              textColor: [255, 255, 255],
              fontStyle: "bold",
            },
            columnStyles: {
              1: { halign: "center" },
              2: { halign: "right" },
              3: { halign: "right" },
              4: { halign: "right" },
              5: { halign: "right" },
              6: { halign: "right" },
            },
          });
        }

        // Invoice type summary always on a separate page
        if (
          processedData.summary.byTipoComprobante &&
          Object.keys(processedData.summary.byTipoComprobante).length > 0
        ) {
          // Always start a new page for this section
          doc.addPage();
          yPos = 20;

          yPos = addTitle("Resumen por Tipo de Comprobante", yPos);
          yPos += 10;

          const tipoData: Array<Array<string>> = [];

          for (const [tipo, data] of Object.entries(
            processedData.summary.byTipoComprobante
          )) {
            const tipoText = getTipoComprobanteText(tipo);

            tipoData.push([
              `${tipoText} (${tipo})`,
              data.count.toString(),
              formatCurrency(data.subtotal),
              formatCurrency(data.taxes),
              formatCurrency(data.total),
            ]);
          }

          autoTable(doc, {
            startY: yPos,
            head: [
              [
                "Tipo de Comprobante",
                "Facturas",
                "Subtotal",
                "Impuestos",
                "Total",
              ],
            ],
            body: tipoData,
            theme: "grid",
            styles: {
              fontSize: 9,
              cellPadding: 3,
              lineColor: [200, 200, 200],
              lineWidth: 0.1,
            },
            headStyles: {
              fillColor: [0, 51, 102],
              textColor: [255, 255, 255],
              fontStyle: "bold",
            },
            columnStyles: {
              1: { halign: "center" },
              2: { halign: "right" },
              3: { halign: "right" },
              4: { halign: "right" },
            },
          });
        }

        // Add footer to all pages
        const pageCount = (doc.internal as any).getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);

        for (let i = 1; i <= pageCount; i++) {
          doc.setPage(i);
          doc.text(
            `Reporte de Facturas CFDI - ${invoiceData.empresaNombre}`,
            14,
            doc.internal.pageSize.height - 10
          );
          doc.text(
            `Página ${i} de ${pageCount}`,
            doc.internal.pageSize.width - 30,
            doc.internal.pageSize.height - 10
          );
        }

        // Save PDF
        const fileName = `Reporte_Facturas_CFDI_${invoiceData.empresaNombre}.pdf`;
        doc.save(fileName);

        await new Promise((resolve) => setTimeout(resolve, 500)); // Small delay for animation

        return fileName;
      })(),
      {
        loading: "Generando PDF...",
        success: (fileName) => `PDF "${fileName}" generado correctamente`,
        error: (e: any) => `Error al generar el PDF: ${e.message}`,
      }
    );
  };

  // Handle input change
  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    // Clear errors when field is corrected
    if (errors[name as keyof ValidationErrors]) {
      setErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name as keyof ValidationErrors];
        return newErrors;
      });
    }

    setInvoiceData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // Clear all files
  const clearFiles = () => {
    if (xmlFiles.length === 0) return;

    toast.promise(
      new Promise<void>((resolve) => {
        setXmlFiles([]);
        setTimeout(() => resolve(), 300);
      }),
      {
        loading: "Limpiando archivos...",
        success: "Todos los archivos han sido eliminados",
        error: "Error al limpiar los archivos",
      }
    );
  };

  // Render sort icon
  const renderSortIcon = (key: string, sortConfig: SortConfig) => {
    if (sortConfig.key !== key) {
      return <span className="ml-1 opacity-50">↕</span>;
    }
    return sortConfig.direction === "asc" ? (
      <ChevronUp className="inline-block ml-1 h-4 w-4" />
    ) : (
      <ChevronDown className="inline-block ml-1 h-4 w-4" />
    );
  };

  const paginatedXmlFiles = useMemo(() => {
    const startIndex = (currentXmlPage - 1) * xmlFilesPerPage;
    return xmlFiles.slice(startIndex, startIndex + xmlFilesPerPage);
  }, [xmlFiles, currentXmlPage]);

  // Calculate total pages
  const totalXmlPages = useMemo(() => {
    return Math.ceil(xmlFiles.length / xmlFilesPerPage);
  }, [xmlFiles.length]);

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster
        position="top-right"
        expand={false}
        richColors
        closeButton
        theme="light"
        toastOptions={{
          duration: 4000,
          style: {
            fontSize: "14px",
          },
        }}
      />

      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Procesador de CFDI (XML)
          </h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid grid-cols-3 w-full max-w-md mx-auto mb-6">
            <TabsTrigger value="upload">Subir archivos</TabsTrigger>
            <TabsTrigger value="results" disabled={!processedData}>
              Resultados
            </TabsTrigger>
            <TabsTrigger value="exports" disabled={!processedData}>
              Exportar
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Información de la Empresa</CardTitle>
                <CardDescription>
                  Ingresa los datos necesarios para generar el reporte
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="empresaNombre">
                      Denominación/Razón Social{" "}
                      <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="empresaNombre"
                      name="empresaNombre"
                      value={invoiceData.empresaNombre}
                      onChange={handleInputChange}
                      placeholder="Denominación/Razón Social"
                      className={errors.empresaNombre ? "border-red-500" : ""}
                    />
                    {errors.empresaNombre && (
                      <p className="text-xs text-red-500 mt-1">
                        {errors.empresaNombre}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="nombreComercial">
                      Nombre Comercial <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="nombreComercial"
                      name="nombreComercial"
                      value={invoiceData.nombreComercial}
                      onChange={handleInputChange}
                      placeholder="Nombre Comercial"
                      className={errors.nombreComercial ? "border-red-500" : ""}
                    />
                    {errors.nombreComercial && (
                      <p className="text-xs text-red-500 mt-1">
                        {errors.nombreComercial}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rfc">
                      RFC <span className="text-red-500">*</span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="ml-1 inline-flex">
                              <AlertCircle className="h-3 w-3 text-gray-400" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="w-60 text-xs">
                              El RFC debe tener 12 caracteres para personas
                              morales o 13 para personas físicas. Formato: 3 o 4
                              letras + 6 dígitos de fecha + 3 caracteres de
                              homoclave.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </Label>
                    <Input
                      id="rfc"
                      name="rfc"
                      value={invoiceData.rfc}
                      onChange={handleInputChange}
                      placeholder="RFC"
                      className={errors.rfc ? "border-red-500" : ""}
                      maxLength={13}
                    />
                    {errors.rfc && (
                      <p className="text-xs text-red-500 mt-1">{errors.rfc}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="domicilioFiscal">
                      Domicilio Fiscal <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="domicilioFiscal"
                      name="domicilioFiscal"
                      value={invoiceData.domicilioFiscal}
                      onChange={handleInputChange}
                      placeholder="Domicilio fiscal completo"
                      className={errors.domicilioFiscal ? "border-red-500" : ""}
                    />
                    {errors.domicilioFiscal && (
                      <p className="text-xs text-red-500 mt-1">
                        {errors.domicilioFiscal}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="regimenFiscal">
                      Régimen Fiscal <span className="text-red-500">*</span>
                    </Label>
                    <Select
                      value={invoiceData.regimenFiscal}
                      onValueChange={(value) => {
                        setInvoiceData((prev) => ({
                          ...prev,
                          regimenFiscal: value,
                        }));

                        // Clear error if field is corrected
                        if (errors.regimenFiscal) {
                          setErrors((prev) => {
                            const newErrors = { ...prev };
                            delete newErrors.regimenFiscal;
                            return newErrors;
                          });
                        }
                      }}
                    >
                      <SelectTrigger
                        id="regimenFiscal"
                        className={errors.regimenFiscal ? "border-red-500" : ""}
                      >
                        <SelectValue placeholder="Seleccionar régimen fiscal" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="601">
                          601 - General de Ley Personas Morales
                        </SelectItem>
                        <SelectItem value="603">
                          603 - Personas Morales con Fines no Lucrativos
                        </SelectItem>
                        <SelectItem value="605">
                          605 - Sueldos y Salarios e Ingresos Asimilados a
                          Salarios
                        </SelectItem>
                        <SelectItem value="606">606 - Arrendamiento</SelectItem>
                        <SelectItem value="607">
                          607 - Régimen de Enajenación o Adquisición de Bienes
                        </SelectItem>
                        <SelectItem value="608">
                          608 - Demás ingresos
                        </SelectItem>
                        <SelectItem value="609">609 - Consolidación</SelectItem>
                        <SelectItem value="610">
                          610 - Residentes en el Extranjero sin Establecimiento
                          Permanente en México
                        </SelectItem>
                        <SelectItem value="611">
                          611 - Ingresos por Dividendos (socios y accionistas)
                        </SelectItem>
                        <SelectItem value="612">
                          612 - Personas Físicas con Actividades Empresariales y
                          Profesionales
                        </SelectItem>
                        <SelectItem value="614">
                          614 - Ingresos por intereses
                        </SelectItem>
                        <SelectItem value="615">
                          615 - Régimen de los ingresos por obtención de premios
                        </SelectItem>
                        <SelectItem value="616">
                          616 - Sin obligaciones fiscales
                        </SelectItem>
                        <SelectItem value="620">
                          620 - Sociedades Cooperativas de Producción
                        </SelectItem>
                        <SelectItem value="621">
                          621 - Incorporación Fiscal
                        </SelectItem>
                        <SelectItem value="622">
                          622 - Actividades Agrícolas, Ganaderas, Silvícolas y
                          Pesqueras
                        </SelectItem>
                        <SelectItem value="623">
                          623 - Opcional para Grupos de Sociedades
                        </SelectItem>
                        <SelectItem value="624">624 - Coordinados</SelectItem>
                        <SelectItem value="625">
                          625 - Régimen de las Actividades Empresariales con
                          ingresos a través de Plataformas Tecnológicas
                        </SelectItem>
                        <SelectItem value="626">
                          626 - Régimen Simplificado de Confianza
                        </SelectItem>
                        <SelectItem value="628">628 - Hidrocarburos</SelectItem>
                        <SelectItem value="629">
                          629 - De los Regímenes Fiscales Preferentes y de las
                          Empresas Multinacionales
                        </SelectItem>
                        <SelectItem value="630">
                          630 - Enajenación de acciones en bolsa de valores
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {errors.regimenFiscal && (
                      <p className="text-xs text-red-500 mt-1">
                        {errors.regimenFiscal}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
                  <div className="flex items-start">
                    <Info className="h-5 w-5 text-blue-500 mt-0.5 mr-2 flex-shrink-0" />
                    <div>
                      <h4 className="text-sm font-medium text-blue-800">
                        Importante sobre los datos fiscales
                      </h4>
                      <p className="text-xs text-blue-600 mt-1">
                        Los datos ingresados se utilizarán para los reportes
                        generados. El sistema procesará todas las facturas XML
                        cargadas independientemente de su fecha y mostrará un
                        análisis completo, incluyendo el correcto manejo de
                        facturas de egreso (que se restan del total), facturas
                        de ingreso y comprobantes de pago.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Subir Archivos XML</CardTitle>
                <CardDescription>
                  Selecciona uno o varios archivos XML de CFDI o arrástralos
                  directamente al área indicada
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-6">
                  <div
                    ref={dropZoneRef}
                    className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors
                      ${
                        isDragging
                          ? "border-blue-500 bg-blue-50"
                          : "border-gray-300"
                      }
                      ${
                        isProcessing
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer"
                      }`}
                    onClick={() =>
                      !isProcessing && fileInputRef.current?.click()
                    }
                  >
                    <Upload
                      className={`mx-auto h-12 w-12 ${
                        isDragging ? "text-blue-500" : "text-gray-400"
                      }`}
                    />
                    <div className="mt-4">
                      <label
                        htmlFor="file-upload"
                        className="relative cursor-pointer rounded-md font-medium text-blue-600 hover:text-blue-500 focus-within:outline-none"
                      >
                        <span>Selecciona archivos</span>
                        <Input
                          ref={fileInputRef}
                          id="file-upload"
                          name="file-upload"
                          type="file"
                          accept=".xml"
                          multiple
                          className="sr-only"
                          onChange={handleFileUpload}
                          disabled={isProcessing}
                        />
                      </label>
                      <span className="pl-1 text-gray-500">
                        {" "}
                        o arrastra y suelta aquí
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Solo archivos XML (CFDI)
                    </p>

                    {isProcessing && (
                      <div className="mt-4">
                        <p className="text-sm text-blue-600 mb-2">
                          Procesando archivos...
                        </p>
                        <Progress value={processingProgress} />
                      </div>
                    )}
                  </div>
                </div>
                {paginatedXmlFiles.map((file, index) => (
                  <li
                    key={index}
                    className="flex items-center justify-between py-3 pl-3 pr-4 text-sm"
                  >
                    <div className="flex items-center flex-1 w-0">
                      <FileText className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      <span className="ml-2 flex-1 w-0 truncate">
                        {file.name}
                      </span>
                    </div>
                    <div className="ml-4 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          removeFile(
                            (currentXmlPage - 1) * xmlFilesPerPage + index
                          )
                        }
                        disabled={isProcessing}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                ))}

                {xmlFiles.length > xmlFilesPerPage && (
                  <div className="flex items-center justify-between px-4 py-3 bg-white border-t mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                      disabled={currentXmlPage === 1}
                      onClick={() => setCurrentXmlPage((prev) => prev - 1)}
                    >
                      Anterior
                    </Button>
                    <span className="text-sm">
                      Página {currentXmlPage} de {totalXmlPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 px-3"
                      disabled={currentXmlPage === totalXmlPages}
                      onClick={() => setCurrentXmlPage((prev) => prev + 1)}
                    >
                      Siguiente
                    </Button>
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-between">
                <Button
                  variant="outline"
                  onClick={clearFiles}
                  disabled={xmlFiles.length === 0 || isProcessing}
                >
                  Limpiar
                </Button>
                <Button
                  onClick={processXmlFiles}
                  disabled={xmlFiles.length === 0 || isProcessing}
                >
                  {isProcessing ? "Procesando..." : "Procesar Facturas"}
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>

          <TabsContent value="results">
            {processedData && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Resumen</CardTitle>
                    <CardDescription>
                      Información general de las facturas procesadas para el
                      período {processedData.summary.dateRange.minDate} al{" "}
                      {processedData.summary.dateRange.maxDate}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-white border rounded-lg shadow-sm p-4">
                        <p className="text-sm text-gray-500 font-medium flex items-center">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 mr-2">
                            <Inbox className="h-5 w-5 text-gray-600" />
                          </span>
                          Total Facturas
                        </p>
                        <p className="text-2xl font-bold mt-1">
                          {processedData.summary.invoiceCount}
                        </p>
                      </div>
                      <div className="bg-white border rounded-lg shadow-sm p-4">
                        <p className="text-sm text-green-600 font-medium flex items-center">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-green-100 mr-2">
                            <ArrowUp className="h-5 w-5 text-green-600" />
                          </span>
                          Ingresos
                        </p>
                        <div className="flex justify-between items-end">
                          <p className="text-2xl font-bold mt-1 text-green-700">
                            {formatCurrency(
                              processedData.summary.ingresosTotal
                            )}
                          </p>
                          <p className="text-sm text-gray-500">
                            ({processedData.summary.ingresosCount})
                          </p>
                        </div>
                      </div>
                      <div className="bg-white border rounded-lg shadow-sm p-4">
                        <p className="text-sm text-red-600 font-medium flex items-center">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-red-100 mr-2">
                            <ArrowDown className="h-5 w-5 text-red-600" />
                          </span>
                          Egresos
                        </p>
                        <div className="flex justify-between items-end">
                          <p className="text-2xl font-bold mt-1 text-red-700">
                            -
                            {formatCurrency(processedData.summary.egresosTotal)}
                          </p>
                          <p className="text-sm text-gray-500">
                            ({processedData.summary.egresosCount})
                          </p>
                        </div>
                      </div>
                      <div className="bg-white border rounded-lg shadow-sm p-4">
                        <p className="text-sm text-blue-600 font-medium flex items-center">
                          <span className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 mr-2">
                            <CreditCard className="h-5 w-5 text-blue-600" />
                          </span>
                          Pagos
                        </p>
                        <div className="flex justify-between items-end">
                          <p className="text-2xl font-bold mt-1 text-blue-700">
                            {formatCurrency(processedData.summary.pagosTotal)}
                          </p>
                          <p className="text-sm text-gray-500">
                            ({processedData.summary.pagosCount})
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="bg-white border rounded-lg shadow-sm p-4 md:col-span-2">
                        <h3 className="text-lg font-medium text-gray-800 mb-4">
                          Resumen por Tipo de Comprobante
                        </h3>
                        <div className="table-container">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Tipo
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Facturas
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Subtotal
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Impuestos
                                </th>
                                <th
                                  scope="col"
                                  className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                >
                                  Total
                                </th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {processedData.summary.byTipoComprobante &&
                                Object.entries(
                                  processedData.summary.byTipoComprobante
                                ).map(([tipo, data]) => (
                                  <tr
                                    key={tipo}
                                    className={
                                      tipo === "E"
                                        ? "bg-red-50"
                                        : tipo === "I"
                                        ? "bg-green-50"
                                        : tipo === "P"
                                        ? "bg-blue-50"
                                        : ""
                                    }
                                  >
                                    <td className="px-3 py-2 whitespace-nowrap">
                                      {getTipoComprobanteBadge(tipo)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                                      {data.count}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right">
                                      {formatCurrency(data.subtotal)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right">
                                      {formatCurrency(data.taxes)}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                                      {formatCurrency(data.total)}
                                    </td>
                                  </tr>
                                ))}
                              <tr className="bg-gray-50 font-semibold">
                                <td className="px-3 py-2 whitespace-nowrap">
                                  TOTAL
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  {processedData.summary.invoiceCount}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  {formatCurrency(
                                    processedData.summary.totalSubtotal
                                  )}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  {formatCurrency(
                                    processedData.summary.totalTaxes
                                  )}
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  {formatCurrency(
                                    processedData.summary.totalAmount
                                  )}
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div className="bg-white border rounded-lg shadow-sm p-4">
                        <h3 className="text-lg font-medium text-gray-800 mb-4">
                          Balance Final
                        </h3>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center pb-2 border-b">
                            <span className="text-sm font-medium text-gray-600">
                              Ingresos:
                            </span>
                            <span className="text-sm font-medium text-green-600">
                              {formatCurrency(
                                processedData.summary.ingresosTotal
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pb-2 border-b">
                            <span className="text-sm font-medium text-gray-600">
                              Egresos:
                            </span>
                            <span className="text-sm font-medium text-red-600">
                              -
                              {formatCurrency(
                                processedData.summary.egresosTotal
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pb-2 border-b">
                            <span className="text-sm font-medium text-gray-600">
                              Pagos:
                            </span>
                            <span className="text-sm font-medium text-blue-600">
                              {formatCurrency(processedData.summary.pagosTotal)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-2">
                            <span className="text-base font-semibold">
                              Subtotal:
                            </span>
                            <span className="text-base font-semibold">
                              {formatCurrency(
                                processedData.summary.totalSubtotal
                              )}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-base font-semibold">
                              Impuestos:
                            </span>
                            <span className="text-base font-semibold">
                              {formatCurrency(processedData.summary.totalTaxes)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-2 border-t">
                            <span className="text-lg font-bold">Total:</span>
                            <span className="text-lg font-bold">
                              {formatCurrency(
                                processedData.summary.totalAmount
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Monthly summary */}
                    {processedData.summary.byMonth &&
                      Object.keys(processedData.summary.byMonth).length > 0 && (
                        <div className="mt-8 bg-white border rounded-lg shadow-sm p-4">
                          <h3 className="text-lg font-medium text-gray-800 mb-4">
                            Distribución por Mes
                          </h3>
                          <div className="table-container">
                            <table className="min-w-full divide-y divide-gray-200">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Mes
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Facturas
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Ingresos (I)
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Egresos (E)
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Pagos (P)
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Impuestos
                                  </th>
                                  <th
                                    scope="col"
                                    className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                                  >
                                    Total
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="bg-white divide-y divide-gray-200">
                                {Object.entries(processedData.summary.byMonth)
                                  .sort(([a], [b]) => a.localeCompare(b))
                                  .map(([month, data]) => {
                                    const [year, monthNum] = month.split("-");
                                    const monthName = getMonthName(monthNum);

                                    return (
                                      <tr key={month}>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                          <span className="font-medium">
                                            {monthName}
                                          </span>{" "}
                                          {year}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right">
                                          {data.count}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right text-green-600">
                                          {data.ingresoCount > 0
                                            ? `${
                                                data.ingresoCount
                                              } / ${formatCurrency(
                                                data.ingresos
                                              )}`
                                            : "-"}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right text-red-600">
                                          {data.egresoCount > 0
                                            ? `${
                                                data.egresoCount
                                              } / -${formatCurrency(
                                                data.egresos
                                              )}`
                                            : "-"}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right text-blue-600">
                                          {data.pagoCount > 0
                                            ? `${
                                                data.pagoCount
                                              } / ${formatCurrency(data.pagos)}`
                                            : "-"}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right">
                                          {formatCurrency(data.taxes)}
                                        </td>
                                        <td className="px-3 py-2 whitespace-nowrap text-right font-medium">
                                          {formatCurrency(data.total)}
                                        </td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-col space-y-1.5 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                    <div>
                      <CardTitle>Detalle de Facturas</CardTitle>
                      <CardDescription>
                        Listado de todas las facturas procesadas
                      </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                        <Input
                          placeholder="Buscar..."
                          className="pl-8 w-[200px] lg:w-[300px]"
                          value={invoiceSearch}
                          onChange={(e) => setInvoiceSearch(e.target.value)}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <div className="table-container">
                        <table className="w-full text-sm text-left text-gray-500">
                          <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("uuid", "invoice")
                                }
                              >
                                UUID
                                {renderSortIcon("uuid", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("folio", "invoice")
                                }
                              >
                                Folio
                                {renderSortIcon("folio", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("fecha", "invoice")
                                }
                              >
                                Fecha
                                {renderSortIcon("fecha", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("emisor", "invoice")
                                }
                              >
                                Emisor
                                {renderSortIcon("emisor", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("tipo", "invoice")
                                }
                              >
                                Tipo
                                {renderSortIcon("tipo", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("subtotal", "invoice")
                                }
                              >
                                Subtotal
                                {renderSortIcon("subtotal", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("impuestos", "invoice")
                                }
                              >
                                Impuestos
                                {renderSortIcon("impuestos", invoiceSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("total", "invoice")
                                }
                              >
                                Total
                                {renderSortIcon("total", invoiceSort)}
                              </th>
                            </tr>
                            <tr>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Filtrar UUID"
                                  className="h-8 text-xs"
                                  value={invoiceFilter.uuid || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "uuid",
                                      e.target.value || null,
                                      "invoice"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Filtrar Folio"
                                  className="h-8 text-xs"
                                  value={invoiceFilter.folio || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "folio",
                                      e.target.value || null,
                                      "invoice"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <div className="relative">
                                  <Calendar className="absolute left-2 top-1.5 h-4 w-4 text-gray-400" />
                                  <Input
                                    placeholder="YYYY-MM-DD"
                                    className="h-8 text-xs pl-8"
                                    value={invoiceFilter.fecha || ""}
                                    onChange={(e) =>
                                      handleFilterChange(
                                        "fecha",
                                        e.target.value || null,
                                        "invoice"
                                      )
                                    }
                                  />
                                </div>
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Filtrar Emisor"
                                  className="h-8 text-xs"
                                  value={invoiceFilter.emisor || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "emisor",
                                      e.target.value || null,
                                      "invoice"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Select
                                  value={
                                    invoiceFilter.tipo?.toString() || "all"
                                  }
                                  onValueChange={(value) =>
                                    handleFilterChange(
                                      "tipo",
                                      value === "all" ? null : value,
                                      "invoice"
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Tipo" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="I">Ingreso</SelectItem>
                                    <SelectItem value="E">Egreso</SelectItem>
                                    <SelectItem value="P">Pago</SelectItem>
                                    <SelectItem value="T">Traslado</SelectItem>
                                    <SelectItem value="N">Nómina</SelectItem>
                                  </SelectContent>
                                </Select>
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={invoiceFilter.subtotal || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "subtotal",
                                      e.target.value || null,
                                      "invoice"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={invoiceFilter.impuestos || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "impuestos",
                                      e.target.value || null,
                                      "invoice"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={invoiceFilter.total || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "total",
                                      e.target.value || null,
                                      "invoice"
                                    )
                                  }
                                />
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedInvoices.map((invoice, index) => {
                              const tipo =
                                invoice.data.comprobante.tipoComprobante;
                              const isEgreso = tipo === "E";
                              const rowClass = isEgreso
                                ? "bg-red-50"
                                : tipo === "I"
                                ? "bg-green-50"
                                : tipo === "P"
                                ? "bg-blue-50"
                                : "bg-white";

                              return (
                                <tr
                                  key={index}
                                  className={`${rowClass} border-b hover:bg-opacity-80`}
                                >
                                  <td className="px-6 py-3 font-mono text-xs">
                                    {invoice.data.uuid}
                                  </td>
                                  <td className="px-6 py-3">
                                    {invoice.data.serie
                                      ? `${invoice.data.serie}-${invoice.data.folio}`
                                      : invoice.data.folio || "-"}
                                  </td>
                                  <td className="px-6 py-3">
                                    {new Date(
                                      invoice.data.fecha
                                    ).toLocaleDateString("es-MX")}
                                  </td>
                                  <td className="px-6 py-3">
                                    <div className="font-medium">
                                      {invoice.data.emisor.nombre}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {invoice.data.emisor.rfc}
                                    </div>
                                  </td>
                                  <td className="px-6 py-3">
                                    {getTipoComprobanteBadge(tipo)}
                                  </td>
                                  <td className="px-6 py-3 text-right">
                                    {formatCurrency(
                                      invoice.data.comprobante.subTotal
                                    )}
                                  </td>
                                  <td className="px-6 py-3 text-right">
                                    {formatCurrency(
                                      invoice.data.impuestos
                                        .totalImpuestosTrasladados
                                    )}
                                  </td>
                                  <td className="px-6 py-3 text-right font-medium">
                                    {formatCurrency(
                                      invoice.data.comprobante.total
                                    )}
                                  </td>
                                </tr>
                              );
                            })}

                            {paginatedInvoices.length === 0 && (
                              <tr className="bg-white border-b">
                                <td
                                  colSpan={8}
                                  className="px-6 py-4 text-center text-gray-500"
                                >
                                  No se encontraron resultados con los filtros
                                  aplicados.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination controls */}
                      {filteredInvoices.length > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 bg-white border-t">
                          <div className="flex items-center text-sm text-gray-700">
                            <span className="mr-2">
                              Mostrando{" "}
                              {(invoicePagination.currentPage - 1) *
                                invoicePagination.pageSize +
                                1}{" "}
                              a{" "}
                              {Math.min(
                                invoicePagination.currentPage *
                                  invoicePagination.pageSize,
                                filteredInvoices.length
                              )}{" "}
                              de {filteredInvoices.length} facturas
                            </span>
                            <Select
                              value={invoicePagination.pageSize.toString()}
                              onValueChange={(value) =>
                                changePageSize(parseInt(value), "invoice")
                              }
                            >
                              <SelectTrigger className="h-8 w-[110px]">
                                <SelectValue placeholder="10 por página" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">
                                  10 por página
                                </SelectItem>
                                <SelectItem value="25">
                                  25 por página
                                </SelectItem>
                                <SelectItem value="50">
                                  50 por página
                                </SelectItem>
                                <SelectItem value="100">
                                  100 por página
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3"
                              disabled={invoicePagination.currentPage === 1}
                              onClick={() =>
                                changePage(
                                  invoicePagination.currentPage - 1,
                                  "invoice"
                                )
                              }
                            >
                              Anterior
                            </Button>

                            {getPageNumbers(
                              totalInvoicePages,
                              invoicePagination.currentPage
                            ).map((pageNum, idx) =>
                              pageNum < 0 ? (
                                <span key={`ellipsis-${idx}`} className="px-1">
                                  ...
                                </span>
                              ) : (
                                <Button
                                  key={`page-${pageNum}`}
                                  variant="outline"
                                  size="sm"
                                  className={`h-8 px-3 ${
                                    pageNum === invoicePagination.currentPage
                                      ? "bg-blue-50 border-blue-200"
                                      : ""
                                  }`}
                                  onClick={() => changePage(pageNum, "invoice")}
                                >
                                  {pageNum}
                                </Button>
                              )
                            )}

                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3"
                              disabled={
                                invoicePagination.currentPage ===
                                totalInvoicePages
                              }
                              onClick={() =>
                                changePage(
                                  invoicePagination.currentPage + 1,
                                  "invoice"
                                )
                              }
                            >
                              Siguiente
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="flex flex-col space-y-1.5 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
                    <div>
                      <CardTitle>Conceptos</CardTitle>
                      <CardDescription>
                        Detalle de los conceptos en las facturas
                      </CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500" />
                        <Input
                          placeholder="Buscar en conceptos..."
                          className="pl-8 w-[200px] lg:w-[300px]"
                          value={conceptSearch}
                          onChange={(e) => setConceptSearch(e.target.value)}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <div className="table-container">
                        <table className="w-full text-sm text-left text-gray-500">
                          <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                            <tr>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("uuid", "concept")
                                }
                              >
                                UUID
                                {renderSortIcon("uuid", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("fecha", "concept")
                                }
                              >
                                Fecha
                                {renderSortIcon("fecha", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("tipo", "concept")
                                }
                              >
                                Tipo
                                {renderSortIcon("tipo", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("descripcion", "concept")
                                }
                              >
                                Descripción
                                {renderSortIcon("descripcion", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("cantidad", "concept")
                                }
                              >
                                Cantidad
                                {renderSortIcon("cantidad", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("valorUnitario", "concept")
                                }
                              >
                                Valor Unit.
                                {renderSortIcon("valorUnitario", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("importe", "concept")
                                }
                              >
                                Importe
                                {renderSortIcon("importe", conceptSort)}
                              </th>
                              <th
                                scope="col"
                                className="px-6 py-3 text-right cursor-pointer hover:bg-gray-100"
                                onClick={() =>
                                  handleSortChange("impuestos", "concept")
                                }
                              >
                                Impuestos
                                {renderSortIcon("impuestos", conceptSort)}
                              </th>
                            </tr>
                            <tr>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Filtrar UUID"
                                  className="h-8 text-xs"
                                  value={conceptFilter.uuid || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "uuid",
                                      e.target.value || null,
                                      "concept"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <div className="relative">
                                  <Calendar className="absolute left-2 top-1.5 h-4 w-4 text-gray-400" />
                                  <Input
                                    placeholder="YYYY-MM-DD"
                                    className="h-8 text-xs pl-8"
                                    value={conceptFilter.fecha || ""}
                                    onChange={(e) =>
                                      handleFilterChange(
                                        "fecha",
                                        e.target.value || null,
                                        "concept"
                                      )
                                    }
                                  />
                                </div>
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Select
                                  value={
                                    conceptFilter.tipo?.toString() || "all"
                                  }
                                  onValueChange={(value) =>
                                    handleFilterChange(
                                      "tipo",
                                      value === "all" ? null : value,
                                      "concept"
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue placeholder="Tipo" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="I">Ingreso</SelectItem>
                                    <SelectItem value="E">Egreso</SelectItem>
                                    <SelectItem value="P">Pago</SelectItem>
                                    <SelectItem value="T">Traslado</SelectItem>
                                    <SelectItem value="N">Nómina</SelectItem>
                                  </SelectContent>
                                </Select>
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Filtrar Descripción"
                                  className="h-8 text-xs"
                                  value={conceptFilter.descripcion || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "descripcion",
                                      e.target.value || null,
                                      "concept"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={conceptFilter.cantidad || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "cantidad",
                                      e.target.value || null,
                                      "concept"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={conceptFilter.valorUnitario || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "valorUnitario",
                                      e.target.value || null,
                                      "concept"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={conceptFilter.importe || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "importe",
                                      e.target.value || null,
                                      "concept"
                                    )
                                  }
                                />
                              </th>
                              <th scope="col" className="px-6 py-2">
                                <Input
                                  placeholder="Min / Max"
                                  className="h-8 text-xs"
                                  value={conceptFilter.impuestos || ""}
                                  onChange={(e) =>
                                    handleFilterChange(
                                      "impuestos",
                                      e.target.value || null,
                                      "concept"
                                    )
                                  }
                                />
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedConcepts.map(
                              ({ invoiceData, concepto }, index) => {
                                const tipo =
                                  invoiceData.comprobante.tipoComprobante;
                                const isEgreso = tipo === "E";
                                const rowClass = isEgreso
                                  ? "bg-red-50"
                                  : tipo === "I"
                                  ? "bg-green-50"
                                  : tipo === "P"
                                  ? "bg-blue-50"
                                  : "bg-white";

                                return (
                                  <tr
                                    key={index}
                                    className={`${rowClass} border-b hover:bg-opacity-80`}
                                  >
                                    <td className="px-6 py-3 font-mono text-xs">
                                      {invoiceData.uuid.substring(0, 8)}...
                                    </td>
                                    <td className="px-6 py-3">
                                      {new Date(
                                        invoiceData.fecha
                                      ).toLocaleDateString("es-MX")}
                                    </td>
                                    <td className="px-6 py-3">
                                      {getTipoComprobanteBadge(tipo)}
                                    </td>
                                    <td className="px-6 py-3">
                                      <div
                                        className="font-medium truncate max-w-[300px]"
                                        title={concepto.descripcion}
                                      >
                                        {concepto.descripcion}
                                      </div>
                                      {concepto.claveProdServ && (
                                        <div className="text-xs text-gray-500">
                                          Clave: {concepto.claveProdServ}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                      {concepto.cantidad} {concepto.unidad}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                      {formatCurrency(concepto.valorUnitario)}
                                    </td>
                                    <td className="px-6 py-3 text-right">
                                      {formatCurrency(
                                        isEgreso
                                          ? -Math.abs(concepto.importe)
                                          : concepto.importe
                                      )}
                                    </td>
                                    <td className="px-6 py-3 text-right font-medium">
                                      {formatCurrency(
                                        isEgreso
                                          ? -Math.abs(concepto.impuestos)
                                          : concepto.impuestos
                                      )}
                                    </td>
                                  </tr>
                                );
                              }
                            )}

                            {paginatedConcepts.length === 0 && (
                              <tr className="bg-white border-b">
                                <td
                                  colSpan={8}
                                  className="px-6 py-4 text-center text-gray-500"
                                >
                                  No se encontraron resultados con los filtros
                                  aplicados.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination for concepts */}
                      {filteredConcepts.length > 0 && (
                        <div className="flex items-center justify-between px-4 py-3 bg-white border-t">
                          <div className="flex items-center text-sm text-gray-700">
                            <span className="mr-2">
                              Mostrando{" "}
                              {(conceptPagination.currentPage - 1) *
                                conceptPagination.pageSize +
                                1}{" "}
                              a{" "}
                              {Math.min(
                                conceptPagination.currentPage *
                                  conceptPagination.pageSize,
                                filteredConcepts.length
                              )}{" "}
                              de {filteredConcepts.length} conceptos
                            </span>
                            <Select
                              value={conceptPagination.pageSize.toString()}
                              onValueChange={(value) =>
                                changePageSize(parseInt(value), "concept")
                              }
                            >
                              <SelectTrigger className="h-8 w-[110px]">
                                <SelectValue placeholder="10 por página" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">
                                  10 por página
                                </SelectItem>
                                <SelectItem value="25">
                                  25 por página
                                </SelectItem>
                                <SelectItem value="50">
                                  50 por página
                                </SelectItem>
                                <SelectItem value="100">
                                  100 por página
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3"
                              disabled={conceptPagination.currentPage === 1}
                              onClick={() =>
                                changePage(
                                  conceptPagination.currentPage - 1,
                                  "concept"
                                )
                              }
                            >
                              Anterior
                            </Button>

                            {getPageNumbers(
                              totalConceptPages,
                              conceptPagination.currentPage
                            ).map((pageNum, idx) =>
                              pageNum < 0 ? (
                                <span key={`ellipsis-${idx}`} className="px-1">
                                  ...
                                </span>
                              ) : (
                                <Button
                                  key={`page-${pageNum}`}
                                  variant="outline"
                                  size="sm"
                                  className={`h-8 px-3 ${
                                    pageNum === conceptPagination.currentPage
                                      ? "bg-blue-50 border-blue-200"
                                      : ""
                                  }`}
                                  onClick={() => changePage(pageNum, "concept")}
                                >
                                  {pageNum}
                                </Button>
                              )
                            )}

                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3"
                              disabled={
                                conceptPagination.currentPage ===
                                totalConceptPages
                              }
                              onClick={() =>
                                changePage(
                                  conceptPagination.currentPage + 1,
                                  "concept"
                                )
                              }
                            >
                              Siguiente
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="exports">
            {processedData && (
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Exportar Información</CardTitle>
                    <CardDescription>
                      Selecciona el formato de exportación deseado
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                      <Card className="border border-gray-200">
                        <CardHeader className="pb-4">
                          <CardTitle className="text-lg flex items-center">
                            <FileText className="h-5 w-5 mr-2 text-blue-600" />
                            Reporte PDF
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-gray-500">
                          <ul className="list-disc pl-5 space-y-1">
                            <li>Reporte detallado con resumen de facturas</li>
                            <li>
                              Separación clara de Ingresos, Egresos y Pagos
                            </li>
                            <li>
                              Análisis por mes para seguimiento de tendencias
                            </li>
                            <li>
                              Desglose de conceptos con valores unitarios e
                              importes
                            </li>
                            <li>Resumen por tipo de comprobante</li>
                            <li>Formato profesional para impresión</li>
                          </ul>
                        </CardContent>
                        <CardFooter>
                          <Button
                            className="w-full bg-blue-600 hover:bg-blue-700"
                            onClick={generatePDF}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Descargar PDF
                          </Button>
                        </CardFooter>
                      </Card>

                      <Card className="border border-gray-200">
                        <CardHeader className="pb-4">
                          <CardTitle className="text-lg flex items-center">
                            <FileSpreadsheet className="h-5 w-5 mr-2 text-green-600" />
                            Archivo Excel
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-gray-500">
                          <ul className="list-disc pl-5 space-y-1">
                            <li>Hoja de cálculo con múltiples pestañas</li>
                            <li>Resumen ejecutivo de todas las facturas</li>
                            <li>Detalle por factura, emisor y receptor</li>
                            <li>Listado completo de conceptos y valores</li>
                            <li>
                              Análisis por mes con secciones para ingresos y
                              egresos
                            </li>
                            <li>
                              Ideal para análisis adicionales y contabilidad
                            </li>
                          </ul>
                        </CardContent>
                        <CardFooter>
                          <Button
                            variant="outline"
                            className="w-full border-green-600 text-green-700 hover:bg-green-50"
                            onClick={generateExcel}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            Descargar Excel
                          </Button>
                        </CardFooter>
                      </Card>
                    </div>
                  </CardContent>
                </Card>

                <Alert className="bg-blue-50 border-blue-200">
                  <Info className="h-4 w-4 text-blue-500" />
                  <AlertTitle className="text-blue-700">
                    Información Importante
                  </AlertTitle>
                  <AlertDescription className="text-blue-600">
                    <p className="mb-2">
                      Los archivos generados contienen información extraída
                      directamente de los XML CFDI. Los montos se calculan
                      correctamente restando los egresos (facturas tipo "E") de
                      los ingresos y pagos.
                    </p>
                    <p>
                      Este reporte puede ser utilizado como apoyo para la
                      declaración de impuestos, pero es recomendable consultar
                      con un contador o profesional fiscal para verificar la
                      información y cumplir con todas las obligaciones fiscales
                      correspondientes.
                    </p>
                  </AlertDescription>
                </Alert>

                {/* Export statistics summary */}
                <Card>
                  <CardHeader>
                    <CardTitle>Estadísticas de Exportación</CardTitle>
                    <CardDescription>
                      Resumen de la información que se incluirá en los archivos
                      exportados
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="border rounded-lg p-4">
                          <h3 className="text-sm font-medium text-gray-700 mb-2">
                            Detalles del Reporte
                          </h3>
                          <ul className="space-y-1 text-sm">
                            <li className="flex justify-between">
                              <span className="text-gray-600">Período:</span>
                              <span className="font-medium">
                                {processedData.summary.dateRange.minDate} al{" "}
                                {processedData.summary.dateRange.maxDate}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Total Facturas:
                              </span>
                              <span className="font-medium">
                                {processedData.summary.invoiceCount}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Facturas de Ingreso (I):
                              </span>
                              <span className="font-medium text-green-600">
                                {processedData.summary.ingresosCount}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Facturas de Egreso (E):
                              </span>
                              <span className="font-medium text-red-600">
                                {processedData.summary.egresosCount}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Comprobantes de Pago (P):
                              </span>
                              <span className="font-medium text-blue-600">
                                {processedData.summary.pagosCount}
                              </span>
                            </li>
                          </ul>
                        </div>

                        <div className="border rounded-lg p-4">
                          <h3 className="text-sm font-medium text-gray-700 mb-2">
                            Balance Final
                          </h3>
                          <ul className="space-y-1 text-sm">
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Ingresos Totales:
                              </span>
                              <span className="font-medium text-green-600">
                                {formatCurrency(
                                  processedData.summary.ingresosTotal
                                )}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Egresos Totales:
                              </span>
                              <span className="font-medium text-red-600">
                                -
                                {formatCurrency(
                                  processedData.summary.egresosTotal
                                )}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="text-gray-600">
                                Pagos Totales:
                              </span>
                              <span className="font-medium text-blue-600">
                                {formatCurrency(
                                  processedData.summary.pagosTotal
                                )}
                              </span>
                            </li>
                            <li className="flex justify-between pt-2 border-t mt-1">
                              <span className="font-medium">Subtotal:</span>
                              <span className="font-medium">
                                {formatCurrency(
                                  processedData.summary.totalSubtotal
                                )}
                              </span>
                            </li>
                            <li className="flex justify-between">
                              <span className="font-medium">Impuestos:</span>
                              <span className="font-medium">
                                {formatCurrency(
                                  processedData.summary.totalTaxes
                                )}
                              </span>
                            </li>
                            <li className="flex justify-between font-medium border-t pt-1 mt-1">
                              <span>Total:</span>
                              <span>
                                {formatCurrency(
                                  processedData.summary.totalAmount
                                )}
                              </span>
                            </li>
                          </ul>
                        </div>
                      </div>

                      {/* Period distribution */}
                      {processedData.summary.byMonth &&
                        Object.keys(processedData.summary.byMonth).length >
                          0 && (
                          <div className="border rounded-lg p-4">
                            <h3 className="text-sm font-medium text-gray-700 mb-2">
                              Distribución por Periodos
                            </h3>
                            <div className="table-container">
                              <table className="w-full text-sm">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left pb-2">Periodo</th>
                                    <th className="text-right pb-2">
                                      Facturas
                                    </th>
                                    <th className="text-right pb-2">
                                      Ingresos (I)
                                    </th>
                                    <th className="text-right pb-2">
                                      Egresos (E)
                                    </th>
                                    <th className="text-right pb-2">
                                      Pagos (P)
                                    </th>
                                    <th className="text-right pb-2">
                                      Impuestos
                                    </th>
                                    <th className="text-right pb-2">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Object.entries(processedData.summary.byMonth)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .map(([month, data]) => {
                                      const [year, monthNum] = month.split("-");
                                      const monthName = getMonthName(monthNum);

                                      return (
                                        <tr
                                          key={month}
                                          className="border-b last:border-b-0"
                                        >
                                          <td className="py-2">
                                            {monthName} {year}
                                          </td>
                                          <td className="text-right py-2">
                                            {data.count}
                                          </td>
                                          <td className="text-right py-2 text-green-600">
                                            {formatCurrency(data.ingresos)}
                                          </td>
                                          <td className="text-right py-2 text-red-600">
                                            -{formatCurrency(data.egresos)}
                                          </td>
                                          <td className="text-right py-2 text-blue-600">
                                            {formatCurrency(data.pagos)}
                                          </td>
                                          <td className="text-right py-2">
                                            {formatCurrency(data.taxes)}
                                          </td>
                                          <td className="text-right py-2 font-medium">
                                            {formatCurrency(data.total)}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default App;
