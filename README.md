# XML CFDI Processor

### ⚠️ spaghetti code, ```App.tsx``` needs to be separated into individual components

A React application for processing Mexican CFDI (Comprobante Fiscal Digital por Internet) XML files, extracting financial data, and generating detailed reports.

## Features

**XML Processing**: Parses CFDI XML files (version 3.3 and 4.0)
**Data Analysis**:

- Handles different invoice types (Ingreso, Egreso, Pago, Traslado, Nómina)
- Correctly calculates totals, subtotals, and taxes
- Distinguishes between income and expense invoices
  **Reporting**:
- Generates PDF reports with detailed invoice information
- Exports data to Excel spreadsheets with multiple worksheets
- Provides monthly summaries and type-based analysis
  **User Interface**:
- Drag and drop file upload
- Filtering and sorting capabilities
- Paginated results for large datasets
- Responsive design

## Technologies Used

- **Frontend**:
  - React 19
- TypeScript
- Tailwind CSS
- ShadCN UI components
- **Libraries**:
  - jsPDF + AutoTable for PDF generation
- xlsx for Excel export
- Sonner for notifications
- Lucide React for icons

## Installation

1. Clone the repository:

```bash
git clone https://github.com/brizuela-go/procesador-xml-cfdi.git
```

2. Navigate to the project directory:
   ```bash
   cd procesador-de-xml-cfdi
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Start the development server:
   ```bash
   pnpm run dev
   ```

## Usage

1. **Enter Company Information**:

- Fill in your company's tax information (RFC, business name, tax regime)

2. **Upload XML Files**:

   - Drag and drop CFDI XML files or click to browse
   - Multiple files can be processed at once

3. **Process Files**:

   - Click "Process Invoices" to analyze the uploaded files
   - View processing progress in real-time

4. **View Results**:

   - See summary statistics and financial overview
   - Browse detailed invoice and concept listings
   - Filter and sort data as needed

5. **Export Reports**:
   - Generate PDF reports with professional formatting
   - Export to Excel for further analysis
   - Reports include:
     - Executive summary
     - Monthly breakdowns
     - Invoice type analysis
     - Detailed concept listings

## Data Handling

The application correctly handles:

- Different invoice types (I, E, P, T, N)
- Tax calculations (including special cases for payment vouchers)
- Currency formatting (MXN)
- Date ranges and monthly summaries
- RFC validation

  ## Configuration

  The application can be configured by modifying:

- `src/App.tsx` for main application logic
- `src/components/ui` for UI components
- `tailwind.config.js` for styling

  ## Build

  To create a production build:

```bash
pnpm run build
```
