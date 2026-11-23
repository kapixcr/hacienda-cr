/**
 * Tests for Factura Electronica input validation (v4.4).
 */

import { describe, it, expect } from "vitest";
import {
  validateFacturaInput,
  validateTiqueteInput,
  validateNotaCreditoInput,
  validateNotaDebitoInput,
  validateMensajeReceptorInput,
  validateReciboPagoInput,
  validateFacturaCompraInput,
  validateFacturaExportacionInput,
} from "./validator.js";
import {
  SIMPLE_TIQUETE,
  TIQUETE_WITH_RECEPTOR,
  MENSAJE_ACEPTACION_TOTAL,
  MENSAJE_ACEPTACION_PARCIAL,
  MENSAJE_RECHAZO,
  MENSAJE_MINIMAL,
  SIMPLE_RECIBO_PAGO,
  SIMPLE_FACTURA_COMPRA,
  SIMPLE_FACTURA_EXPORTACION,
} from "../__fixtures__/document-fixtures.js";
import {
  SIMPLE_INVOICE,
  MULTI_ITEM_INVOICE,
  DISCOUNT_INVOICE,
  EXONERATED_INVOICE,
  EXPORT_INVOICE,
  CREDIT_INVOICE,
  REFERENCE_INVOICE,
} from "../__fixtures__/invoices.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstLineItem(invoice: typeof SIMPLE_INVOICE) {
  const line = invoice.detalleServicio[0];
  expect(line).toBeDefined();
  return line as NonNullable<typeof line>;
}

// ---------------------------------------------------------------------------
// Valid inputs — all fixtures should pass
// ---------------------------------------------------------------------------

describe("validateFacturaInput — valid inputs", () => {
  it.each([
    ["SIMPLE_INVOICE", SIMPLE_INVOICE],
    ["MULTI_ITEM_INVOICE", MULTI_ITEM_INVOICE],
    ["DISCOUNT_INVOICE", DISCOUNT_INVOICE],
    ["EXONERATED_INVOICE", EXONERATED_INVOICE],
    ["CREDIT_INVOICE", CREDIT_INVOICE],
    ["REFERENCE_INVOICE", REFERENCE_INVOICE],
  ] as const)("%s should be valid", (_name, fixture) => {
    const result = validateFacturaInput(fixture);
    if (!result.valid) {
      // Show errors for debugging if a fixture fails unexpectedly
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Schema-level validation failures
// ---------------------------------------------------------------------------

describe("validateFacturaInput — schema errors", () => {
  it("should reject null input", () => {
    const result = validateFacturaInput(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should reject empty object", () => {
    const result = validateFacturaInput({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should reject invalid clave (too short)", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      clave: "12345",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("clave"))).toBe(true);
  });

  it("should reject missing proveedorSistemas (v4.4 required)", () => {
    const { proveedorSistemas: _, ...noProveedor } = SIMPLE_INVOICE;
    const result = validateFacturaInput(noProveedor);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("proveedorSistemas"))).toBe(true);
  });

  it("should reject invalid codigoActividadEmisor", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      codigoActividadEmisor: "12",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("codigoActividadEmisor"))).toBe(true);
  });

  it("should reject missing codigoActividadEmisor", () => {
    const { codigoActividadEmisor: _, ...noActivity } = SIMPLE_INVOICE;
    const result = validateFacturaInput(noActivity);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("codigoActividadEmisor"))).toBe(true);
  });

  it("should reject invalid codigoActividadReceptor when present", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      codigoActividadReceptor: "abc123",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("codigoActividadReceptor"))).toBe(true);
  });

  it("should reject empty detalleServicio", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      detalleServicio: [],
    });
    expect(result.valid).toBe(false);
  });

  it("should reject missing receptor", () => {
    const { receptor: _, ...noReceptor } = SIMPLE_INVOICE;
    const result = validateFacturaInput(noReceptor);
    expect(result.valid).toBe(false);
  });

  it("should reject receptor without identificacion (required for Factura)", () => {
    const { identificacion: _, ...receptorNoId } = SIMPLE_INVOICE.receptor;
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      receptor: receptorNoId,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "receptor.identificacion")).toBe(true);
  });

  it("should reject invalid sale condition code", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      condicionVenta: "50",
    });
    expect(result.valid).toBe(false);
  });

  it("should reject a line item without impuesto (v4.4 requires at least one)", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const { impuesto: _, ...lineNoTax } = baseLine;
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      detalleServicio: [lineNoTax],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("impuesto"))).toBe(true);
  });

  it("should reject a free-text nombreInstitucion in exoneracion (coded in v4.4)", () => {
    const baseLine = firstLineItem(EXONERATED_INVOICE);
    const baseTax = baseLine.impuesto[0];
    expect(baseTax?.exoneracion).toBeDefined();
    const result = validateFacturaInput({
      ...EXONERATED_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          impuesto: [
            {
              ...baseTax,
              exoneracion: {
                ...baseTax?.exoneracion,
                nombreInstitucion: "Ministerio de Educacion Publica",
              },
            },
          ],
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("nombreInstitucion"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// medioPago (v4.4: lives inside resumenFactura, 1-4 entries when present)
// ---------------------------------------------------------------------------

describe("validateFacturaInput — resumenFactura.medioPago", () => {
  it("should reject an empty medioPago array", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        medioPago: [],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("resumenFactura.medioPago"))).toBe(true);
  });

  it("should reject more than 4 medioPago entries", () => {
    const entry = { tipoMedioPago: "01" as const, totalMedioPago: 22600 };
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        medioPago: [entry, entry, entry, entry, entry],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("resumenFactura.medioPago"))).toBe(true);
  });

  it("should accept exactly 4 medioPago entries", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        medioPago: [
          { tipoMedioPago: "01", totalMedioPago: 28250 },
          { tipoMedioPago: "02", totalMedioPago: 28250 },
          { tipoMedioPago: "04", totalMedioPago: 28250 },
          { tipoMedioPago: "06", totalMedioPago: 28250 },
        ],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("should accept an omitted medioPago (optional in the schema)", () => {
    const { medioPago: _, ...resumenNoMedioPago } = SIMPLE_INVOICE.resumenFactura;
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: resumenNoMedioPago,
    });
    expect(result.valid).toBe(true);
  });

  it("should reject an invalid tipoMedioPago code", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        medioPago: [{ tipoMedioPago: "42", totalMedioPago: 113000 }],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("medioPago"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Business rule validation
// ---------------------------------------------------------------------------

describe("validateFacturaInput — business rules", () => {
  it("should detect non-sequential line numbers", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const badInput = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          numeroLinea: 5, // Should be 1
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("numeroLinea"))).toBe(true);
  });

  it("should detect incorrect montoTotal", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const badInput = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          montoTotal: 99999, // Should be 100000 (1 * 100000)
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("montoTotal"))).toBe(true);
  });

  it("should detect incorrect subTotal (with discount)", () => {
    const baseLine = firstLineItem(DISCOUNT_INVOICE);
    const badInput = {
      ...DISCOUNT_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          subTotal: 50000, // Should be 45000 (50000 - 5000 discount)
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("subTotal"))).toBe(true);
  });

  it("should detect incorrect tax amount", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const badInput = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          impuesto: [
            {
              codigo: "01" as const,
              codigoTarifaIVA: "08" as const,
              tarifa: 13,
              monto: 12000, // Should be 13000 (100000 * 0.13)
            },
          ],
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "detalleServicio.0.impuesto.0.monto")).toBe(true);
  });

  it("should include amount-only ISC in the base, net tax and payable total", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const input = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          impuesto: [
            {
              // Amount-only ISC is supplied directly and included in all payable totals.
              codigo: "02" as const,
              monto: 5000,
            },
          ],
          baseImponible: 105000,
          impuestoNeto: 5000,
          montoTotalLinea: 105000,
        },
      ],
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalImpuesto: 5000,
        medioPago: [{ tipoMedioPago: "01" as const, totalMedioPago: 105000 }],
        totalComprobante: 105000,
      },
    };
    const result = validateFacturaInput(input);
    if (!result.valid) {
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
  });

  it("should detect incorrect impuestoNeto", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const badInput = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          impuestoNeto: 12000, // Should be 13000
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("impuestoNeto"))).toBe(true);
  });

  it("should subtract montoExoneracion when checking impuestoNeto", () => {
    const baseLine = firstLineItem(EXONERATED_INVOICE);
    const badInput = {
      ...EXONERATED_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          impuestoNeto: 26000, // Should be 0 (26000 tax - 26000 exonerated)
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "detalleServicio.0.impuestoNeto")).toBe(true);
  });

  it("should detect incorrect montoTotalLinea", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const badInput = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          montoTotalLinea: 100000, // Should be 113000
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("montoTotalLinea"))).toBe(true);
  });

  it("should detect incorrect totalGravado", () => {
    const badInput = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalGravado: 99999, // Should be 100000
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("totalGravado"))).toBe(true);
  });

  it("should detect incorrect totalVenta", () => {
    const badInput = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalVenta: 99999,
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("totalVenta"))).toBe(true);
  });

  it("should include totalNoSujeto in the totalVenta check when present", () => {
    const input = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalNoSujeto: 1000,
        // totalVenta stays 100000, but expected is now 101000
      },
    };
    const result = validateFacturaInput(input);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "resumenFactura.totalVenta")).toBe(true);
  });

  it("should detect incorrect totalVentaNeta", () => {
    const badInput = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalVentaNeta: 99999,
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("totalVentaNeta"))).toBe(true);
  });

  it("should detect incorrect totalComprobante", () => {
    const badInput = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalComprobante: 999999, // Should be 113000
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("totalComprobante"))).toBe(true);
  });

  it("should detect incorrect totalImpuesto", () => {
    const badInput = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalImpuesto: 12000, // Should be 13000
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("totalImpuesto"))).toBe(true);
  });

  it("should subtract totalIVADevuelto in the totalComprobante check", () => {
    const input = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalIVADevuelto: 13000,
        medioPago: [{ tipoMedioPago: "02" as const, totalMedioPago: 100000 }],
        totalComprobante: 100000, // 100000 + 13000 - 13000
      },
    };
    const result = validateFacturaInput(input);
    if (!result.valid) {
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
  });

  it("should add totalOtrosCargos in the totalComprobante check", () => {
    const input = {
      ...SIMPLE_INVOICE,
      otrosCargos: [
        {
          tipoDocumento: "02" as const,
          detalle: "Timbre de ley",
          montoCargo: 500,
        },
      ],
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalOtrosCargos: 500,
        medioPago: [{ tipoMedioPago: "01" as const, totalMedioPago: 113500 }],
        totalComprobante: 113500, // 100000 + 13000 + 500
      },
    };
    const result = validateFacturaInput(input);
    if (!result.valid) {
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
  });

  it("should require plazoCredito when condicionVenta is 02", () => {
    const badInput = {
      ...CREDIT_INVOICE,
      plazoCredito: undefined,
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("plazoCredito"))).toBe(true);
  });

  it("should require codigoTarifaIVA for IVA taxes", () => {
    const baseLine = firstLineItem(SIMPLE_INVOICE);
    const badInput = {
      ...SIMPLE_INVOICE,
      detalleServicio: [
        {
          ...baseLine,
          impuesto: [
            {
              codigo: "01" as const,
              // codigoTarifaIVA is missing
              tarifa: 13,
              monto: 13000,
            },
          ],
        },
      ],
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.path === "detalleServicio.0.impuesto.0.codigoTarifaIVA"),
    ).toBe(true);
    expect(result.errors.some((e) => e.message.includes("codigoTarifaIVA"))).toBe(true);
  });

  it.each([["07"], ["08"]] as const)(
    "should require codigoTarifaIVA for IVA-related code %s",
    (codigo) => {
      const baseLine = firstLineItem(SIMPLE_INVOICE);
      const badInput = {
        ...SIMPLE_INVOICE,
        detalleServicio: [
          {
            ...baseLine,
            impuesto: [
              {
                codigo,
                tarifa: 13,
                monto: 13000,
              },
            ],
          },
        ],
      };
      const result = validateFacturaInput(badInput);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.path === "detalleServicio.0.impuesto.0.codigoTarifaIVA"),
      ).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Optional summary totals (v4.4)
// ---------------------------------------------------------------------------

describe("validateFacturaInput — optional summary totals", () => {
  it("should skip the totalGravado check when it is omitted", () => {
    const { totalGravado: _, ...resumen } = SIMPLE_INVOICE.resumenFactura;
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...resumen,
        // totalVenta must now match only the remaining present components
        totalExento: 0,
        totalExonerado: 100000,
        totalServExonerado: 100000,
        totalServGravados: 0,
      },
    });
    // totalGravado itself is not flagged; the remaining components add up
    expect(result.errors.some((e) => e.path === "resumenFactura.totalGravado")).toBe(false);
  });

  it("should skip the totalExento check when it is omitted", () => {
    const { totalExento: _, ...resumen } = EXPORT_INVOICE.resumenFactura;
    const result = validateFacturaInput({
      ...EXPORT_INVOICE,
      receptor: SIMPLE_INVOICE.receptor,
      resumenFactura: resumen,
    });
    expect(result.errors.some((e) => e.path === "resumenFactura.totalExento")).toBe(false);
    // But totalVenta then no longer adds up (3000 vs 0 from present components)
    expect(result.errors.some((e) => e.path === "resumenFactura.totalVenta")).toBe(true);
  });

  it("should require totalImpuesto when line items carry tax", () => {
    const { totalImpuesto: _, ...resumen } = SIMPLE_INVOICE.resumenFactura;
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...resumen,
        medioPago: [{ tipoMedioPago: "01" as const, totalMedioPago: 100000 }],
        totalComprobante: 100000,
      },
    });
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (e) => e.path === "resumenFactura.totalImpuesto" && e.message.includes("required"),
      ),
    ).toBe(true);
  });

  it("should validate totalExonerado consistency when present", () => {
    const badInput = {
      ...EXONERATED_INVOICE,
      resumenFactura: {
        ...EXONERATED_INVOICE.resumenFactura,
        totalServExonerado: 100000, // totalExonerado stays 200000 → mismatch
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === "resumenFactura.totalExonerado")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("validateFacturaInput — edge cases", () => {
  it("should accept an invoice with 0% exempt tax (export)", () => {
    const result = validateFacturaInput({
      ...EXPORT_INVOICE,
      receptor: SIMPLE_INVOICE.receptor,
    });
    expect(result.valid).toBe(true);
  });

  it("should return structured errors with path and message", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      clave: "short",
    });
    expect(result.valid).toBe(false);
    const firstError = result.errors[0];
    expect(firstError).toBeDefined();
    expect(typeof firstError?.path).toBe("string");
    expect(typeof firstError?.message).toBe("string");
  });

  it("should validate totalExento consistency", () => {
    const badInput = {
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalExento: 5000, // Should be 0 (no exempt items)
      },
    };
    const result = validateFacturaInput(badInput);
    expect(result.valid).toBe(false);
  });

  it("should accept a totalDesgloseImpuesto breakdown in the summary", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalDesgloseImpuesto: [{ codigo: "01", codigoTarifaIVA: "08", totalMontoImpuesto: 13000 }],
      },
    });
    if (!result.valid) {
      console.error("Validation errors:", result.errors);
    }
    expect(result.valid).toBe(true);
  });

  it("should reject an invalid codigo in totalDesgloseImpuesto", () => {
    const result = validateFacturaInput({
      ...SIMPLE_INVOICE,
      resumenFactura: {
        ...SIMPLE_INVOICE.resumenFactura,
        totalDesgloseImpuesto: [{ codigo: "42", totalMontoImpuesto: 13000 }],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path.includes("totalDesgloseImpuesto"))).toBe(true);
  });
});
describe("summary reconciliation regressions", () => {
  it("rejects an internally consistent summary unrelated to its lines", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    Object.assign(invoice.resumenFactura, {
      totalServGravados: 900000,
      totalGravado: 900000,
      totalVenta: 900000,
      totalVentaNeta: 900000,
      totalComprobante: 913000,
    });
    expect(
      validateFacturaInput(invoice).errors.some(
        (issue) => issue.path === "resumenFactura.totalVenta",
      ),
    ).toBe(true);
  });

  it("rejects discounts unrelated to detail discounts", () => {
    const invoice = structuredClone(DISCOUNT_INVOICE);
    Object.assign(invoice.resumenFactura, {
      totalDescuentos: 10000,
      totalVentaNeta: 40000,
      totalComprobante: 45850,
    });
    expect(
      validateFacturaInput(invoice).errors.some(
        (issue) => issue.path === "resumenFactura.totalDescuentos",
      ),
    ).toBe(true);
  });

  it("rejects charges absent from detail", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    Object.assign(invoice.resumenFactura, { totalOtrosCargos: 500, totalComprobante: 113500 });
    expect(
      validateFacturaInput(invoice).errors.some(
        (issue) => issue.path === "resumenFactura.totalOtrosCargos",
      ),
    ).toBe(true);
  });

  it("rejects receptor identification type 06 (No Contribuyente) on Factura Electronica", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    invoice.receptor.identificacion = {
      tipo: "06",
      numero: "NC123456",
    };
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "receptor.identificacion.tipo")).toBe(true);
  });

  it("rejects receptor identification type 05 (Extranjero No Domiciliado) on Factura Electronica", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    invoice.receptor.identificacion = {
      tipo: "05",
      numero: "US123456789",
    };
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "receptor.identificacion.tipo")).toBe(true);
  });

  it.each(["05", "06"] as const)(
    "rejects non-domestic emisor identification type %s on Factura Electronica",
    (tipo) => {
      const invoice = structuredClone(SIMPLE_INVOICE);
      invoice.emisor.identificacion = {
        tipo,
        numero: "EXT123456",
      };
      const result = validateFacturaInput(invoice);
      expect(result.valid).toBe(false);
      expect(result.errors.some((issue) => issue.path === "emisor.identificacion.tipo")).toBe(true);
    },
  );

  it.each(["02", "10"] as const)(
    "rejects condicionVenta %s without plazoCredito",
    (condicionVenta) => {
      const invoice = structuredClone(SIMPLE_INVOICE);
      invoice.condicionVenta = condicionVenta;
      delete invoice.plazoCredito;
      const result = validateFacturaInput(invoice);
      expect(result.valid).toBe(false);
      expect(result.errors.some((issue) => issue.path === "plazoCredito")).toBe(true);
    },
  );

  it("rejects condicionVenta 99 without condicionVentaOtros", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    invoice.condicionVenta = "99";
    delete invoice.condicionVentaOtros;
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "condicionVentaOtros")).toBe(true);
  });

  it("rejects tipoMedioPago 99 without medioPagoOtros", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    invoice.resumenFactura.medioPago = [
      { tipoMedioPago: "99", totalMedioPago: invoice.resumenFactura.totalComprobante },
    ];
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((issue) => issue.path === "resumenFactura.medioPago.0.medioPagoOtros"),
    ).toBe(true);
  });

  it("rejects Contado (01) when sum of totalMedioPago does not equal totalComprobante", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    invoice.condicionVenta = "01";
    invoice.resumenFactura.medioPago = [{ tipoMedioPago: "01", totalMedioPago: 1000 }];
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "resumenFactura.medioPago")).toBe(true);
  });

  it("rejects unidadMedida Otros without unidadMedidaComercial", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    firstLineItem(invoice).unidadMedida = "Otros";
    delete firstLineItem(invoice).unidadMedidaComercial;
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((issue) => issue.path === "detalleServicio.0.unidadMedidaComercial"),
    ).toBe(true);
  });

  it("rejects otrosCargos 99 without tipoDocumentoOtros and 04 without third-party fields", () => {
    const invoice99 = structuredClone(SIMPLE_INVOICE);
    invoice99.otrosCargos = [{ tipoDocumento: "99", detalle: "Otro", montoCargo: 100 }];
    invoice99.resumenFactura.totalOtrosCargos = 100;
    invoice99.resumenFactura.totalComprobante += 100;
    const res99 = validateFacturaInput(invoice99);
    expect(res99.valid).toBe(false);
    expect(res99.errors.some((issue) => issue.path === "otrosCargos.0.tipoDocumentoOtros")).toBe(
      true,
    );

    const invoice04 = structuredClone(SIMPLE_INVOICE);
    invoice04.otrosCargos = [{ tipoDocumento: "04", detalle: "Cobro tercero", montoCargo: 100 }];
    invoice04.resumenFactura.totalOtrosCargos = 100;
    invoice04.resumenFactura.totalComprobante += 100;
    const res04 = validateFacturaInput(invoice04);
    expect(res04.valid).toBe(false);
    expect(res04.errors.some((issue) => issue.path === "otrosCargos.0.identificacionTercero")).toBe(
      true,
    );
    expect(res04.errors.some((issue) => issue.path === "otrosCargos.0.nombreTercero")).toBe(true);
  });

  it("rejects line discounts exceeding montoTotal", () => {
    const invoice = structuredClone(SIMPLE_INVOICE);
    const line = firstLineItem(invoice);
    line.descuento = [
      {
        montoDescuento: line.montoTotal + 1000,
        codigoDescuento: "04",
        naturalezaDescuento: "Excede monto",
      },
    ];
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "detalleServicio.0.descuento")).toBe(true);
  });

  it("rejects exoneration exceeding tax tarifa or monto", () => {
    const invoice = structuredClone(EXONERATED_INVOICE);
    const firstTax = firstLineItem(invoice).impuesto[0];
    if (firstTax?.exoneracion) {
      firstTax.exoneracion.tarifaExonerada = 20;
      firstTax.exoneracion.montoExoneracion = firstTax.monto + 1000;
    }
    const result = validateFacturaInput(invoice);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some(
        (issue) => issue.path === "detalleServicio.0.impuesto.0.exoneracion.tarifaExonerada",
      ),
    ).toBe(true);
    expect(
      result.errors.some(
        (issue) => issue.path === "detalleServicio.0.impuesto.0.exoneracion.montoExoneracion",
      ),
    ).toBe(true);
  });
});

describe("validateNotaCreditoInput", () => {
  it("accepts NC referencing FE (01), ND (02), or TE (04) within original amount", () => {
    for (const tipoDoc of ["01", "02", "04"] as const) {
      const nc = structuredClone(REFERENCE_INVOICE);
      nc.clave = nc.clave.slice(0, 29) + "03" + nc.clave.slice(31);
      nc.numeroConsecutivo =
        nc.numeroConsecutivo.slice(0, 8) + "03" + nc.numeroConsecutivo.slice(10);
      nc.informacionReferencia = [
        {
          tipoDoc,
          numero: SIMPLE_INVOICE.clave,
          fechaEmision: SIMPLE_INVOICE.fechaEmision,
          codigo: "02",
          razon: "Ajuste parcial de monto",
        },
      ];
      const result = validateNotaCreditoInput(nc, {
        originalTotalComprobante: nc.resumenFactura.totalComprobante + 5000,
        originalClave: SIMPLE_INVOICE.clave,
      });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects NC when totalComprobante exceeds originalTotalComprobante", () => {
    const nc = structuredClone(REFERENCE_INVOICE);
    nc.clave = nc.clave.slice(0, 29) + "03" + nc.clave.slice(31);
    nc.numeroConsecutivo = nc.numeroConsecutivo.slice(0, 8) + "03" + nc.numeroConsecutivo.slice(10);
    nc.resumenFactura.totalComprobante = 15000;
    const result = validateNotaCreditoInput(nc, {
      originalTotalComprobante: 10000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "resumenFactura.totalComprobante")).toBe(
      true,
    );
  });

  it("rejects NC referencing unsupported document type (e.g. 03)", () => {
    const nc = structuredClone(REFERENCE_INVOICE);
    nc.clave = nc.clave.slice(0, 29) + "03" + nc.clave.slice(31);
    nc.numeroConsecutivo = nc.numeroConsecutivo.slice(0, 8) + "03" + nc.numeroConsecutivo.slice(10);
    nc.informacionReferencia = [
      {
        tipoDoc: "03",
        numero: SIMPLE_INVOICE.clave,
        fechaEmision: SIMPLE_INVOICE.fechaEmision,
        codigo: "01",
        razon: "Anulacion",
      },
    ];
    const result = validateNotaCreditoInput(nc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "informacionReferencia.0.tipoDoc")).toBe(
      true,
    );
  });
});

describe("validateTiqueteInput", () => {
  it("accepts a Tiquete without receptor", () => {
    expect(validateTiqueteInput(SIMPLE_TIQUETE).valid).toBe(true);
  });

  it("rejects a Tiquete when receptor is provided", () => {
    const result = validateTiqueteInput(TIQUETE_WITH_RECEPTOR);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "receptor")).toBe(true);
  });
});

describe("validateMensajeReceptorInput", () => {
  it("accepts all standard MensajeReceptor fixtures", () => {
    for (const fixture of [
      MENSAJE_ACEPTACION_TOTAL,
      MENSAJE_ACEPTACION_PARCIAL,
      MENSAJE_RECHAZO,
      MENSAJE_MINIMAL,
    ]) {
      expect(validateMensajeReceptorInput(fixture).valid).toBe(true);
    }
  });

  it("rejects mismatch between mensaje and numeroConsecutivoReceptor kind", () => {
    const bad = { ...MENSAJE_RECHAZO, numeroConsecutivoReceptor: "00100001050000000001" };
    const result = validateMensajeReceptorInput(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "numeroConsecutivoReceptor")).toBe(true);
  });

  it("rejects partial acceptance or rejection without detalleMensaje", () => {
    const { detalleMensaje: _, ...noReason } = MENSAJE_ACEPTACION_PARCIAL;
    const result = validateMensajeReceptorInput(noReason);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "detalleMensaje")).toBe(true);
  });

  it("rejects montoTotalImpuestoAcreditar exceeding montoTotalImpuesto", () => {
    const bad = { ...MENSAJE_ACEPTACION_TOTAL, montoTotalImpuestoAcreditar: 15000 };
    const result = validateMensajeReceptorInput(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "montoTotalImpuestoAcreditar")).toBe(true);
  });
});

describe("validateReciboPagoInput", () => {
  it("accepts standard ReciboElectronicoPago fixture", () => {
    expect(validateReciboPagoInput(SIMPLE_RECIBO_PAGO).valid).toBe(true);
  });

  it("rejects non-REP condicionVenta (e.g. 01)", () => {
    const bad = { ...SIMPLE_RECIBO_PAGO, condicionVenta: "01" as const };
    const result = validateReciboPagoInput(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "condicionVenta")).toBe(true);
  });

  it("rejects REP without informacionReferencia", () => {
    const { informacionReferencia: _, ...noRef } = SIMPLE_RECIBO_PAGO;
    const result = validateReciboPagoInput(noRef);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "informacionReferencia")).toBe(true);
  });
});

describe("validateFacturaCompraInput", () => {
  it("accepts standard FacturaElectronicaCompra fixture and supplier type 05/06", () => {
    expect(validateFacturaCompraInput(SIMPLE_FACTURA_COMPRA).valid).toBe(true);

    for (const tipo of ["05", "06"] as const) {
      const fec = structuredClone(SIMPLE_FACTURA_COMPRA);
      fec.emisor.identificacion = { tipo, numero: "EXT123456" };
      expect(validateFacturaCompraInput(fec).valid).toBe(true);
    }
  });

  it("rejects FEC without informacionReferencia", () => {
    const { informacionReferencia: _, ...noRef } = SIMPLE_FACTURA_COMPRA;
    const result = validateFacturaCompraInput(noRef);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "informacionReferencia")).toBe(true);
  });

  it("rejects non-domestic receptor type 05/06 on FEC", () => {
    for (const tipo of ["05", "06"] as const) {
      const fec = structuredClone(SIMPLE_FACTURA_COMPRA);
      if (fec.receptor) {
        fec.receptor.identificacion = { tipo, numero: "EXT123456" };
      }
      const result = validateFacturaCompraInput(fec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((issue) => issue.path === "receptor.identificacion.tipo")).toBe(
        true,
      );
    }
  });
});

describe("validateFacturaExportacionInput", () => {
  it("accepts standard FacturaElectronicaExportacion fixture with foreign buyer 05", () => {
    expect(validateFacturaExportacionInput(SIMPLE_FACTURA_EXPORTACION).valid).toBe(true);
  });

  it("rejects FEE with receptor type 06 or non-domestic emisor", () => {
    const badReceptor = structuredClone(SIMPLE_FACTURA_EXPORTACION);
    if (badReceptor.receptor) {
      badReceptor.receptor.identificacion = { tipo: "06", numero: "NC123456" };
    }
    const resReceptor = validateFacturaExportacionInput(badReceptor);
    expect(resReceptor.valid).toBe(false);
    expect(resReceptor.errors.some((issue) => issue.path === "receptor.identificacion.tipo")).toBe(
      true,
    );

    const badEmisor = structuredClone(SIMPLE_FACTURA_EXPORTACION);
    badEmisor.emisor.identificacion = { tipo: "05", numero: "EXT123456" };
    const resEmisor = validateFacturaExportacionInput(badEmisor);
    expect(resEmisor.valid).toBe(false);
    expect(resEmisor.errors.some((issue) => issue.path === "emisor.identificacion.tipo")).toBe(
      true,
    );
  });
});

describe("validateNotaDebitoInput", () => {
  it("accepts ND referencing FE (01), NC (03), or TE (04) within original amount", () => {
    for (const tipoDoc of ["01", "03", "04"] as const) {
      const nd = structuredClone(REFERENCE_INVOICE);
      nd.clave = nd.clave.slice(0, 29) + "02" + nd.clave.slice(31);
      nd.numeroConsecutivo =
        nd.numeroConsecutivo.slice(0, 8) + "02" + nd.numeroConsecutivo.slice(10);
      nd.informacionReferencia = [
        {
          tipoDoc,
          numero: SIMPLE_INVOICE.clave,
          fechaEmision: SIMPLE_INVOICE.fechaEmision,
          codigo: "02",
          razon: "Ajuste de debito",
        },
      ];
      const result = validateNotaDebitoInput(nd, {
        originalTotalComprobante: nd.resumenFactura.totalComprobante + 5000,
        originalClave: SIMPLE_INVOICE.clave,
      });
      expect(result.valid).toBe(true);
    }
  });

  it("rejects ND when totalComprobante exceeds originalTotalComprobante", () => {
    const nd = structuredClone(REFERENCE_INVOICE);
    nd.clave = nd.clave.slice(0, 29) + "02" + nd.clave.slice(31);
    nd.numeroConsecutivo = nd.numeroConsecutivo.slice(0, 8) + "02" + nd.numeroConsecutivo.slice(10);
    nd.resumenFactura.totalComprobante = 15000;
    const result = validateNotaDebitoInput(nd, {
      originalTotalComprobante: 10000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "resumenFactura.totalComprobante")).toBe(
      true,
    );
  });

  it("rejects ND referencing unsupported document type (e.g. 02)", () => {
    const nd = structuredClone(REFERENCE_INVOICE);
    nd.clave = nd.clave.slice(0, 29) + "02" + nd.clave.slice(31);
    nd.numeroConsecutivo = nd.numeroConsecutivo.slice(0, 8) + "02" + nd.numeroConsecutivo.slice(10);
    nd.informacionReferencia = [
      {
        tipoDoc: "02",
        numero: SIMPLE_INVOICE.clave,
        fechaEmision: SIMPLE_INVOICE.fechaEmision,
        codigo: "01",
        razon: "Anulacion",
      },
    ];
    const result = validateNotaDebitoInput(nd);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "informacionReferencia.0.tipoDoc")).toBe(
      true,
    );
  });
});

describe("validateTiqueteInput", () => {
  it("accepts a Tiquete without receptor", () => {
    expect(validateTiqueteInput(SIMPLE_TIQUETE).valid).toBe(true);
  });

  it("rejects a Tiquete when receptor is provided", () => {
    const result = validateTiqueteInput(TIQUETE_WITH_RECEPTOR);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "receptor")).toBe(true);
  });
});

describe("validateMensajeReceptorInput", () => {
  it("accepts all standard MensajeReceptor fixtures", () => {
    for (const fixture of [
      MENSAJE_ACEPTACION_TOTAL,
      MENSAJE_ACEPTACION_PARCIAL,
      MENSAJE_RECHAZO,
      MENSAJE_MINIMAL,
    ]) {
      expect(validateMensajeReceptorInput(fixture).valid).toBe(true);
    }
  });

  it("rejects mismatch between mensaje and numeroConsecutivoReceptor kind", () => {
    const bad = { ...MENSAJE_RECHAZO, numeroConsecutivoReceptor: "00100001050000000001" };
    const result = validateMensajeReceptorInput(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "numeroConsecutivoReceptor")).toBe(true);
  });

  it("rejects partial acceptance or rejection without detalleMensaje", () => {
    const { detalleMensaje: _, ...noReason } = MENSAJE_ACEPTACION_PARCIAL;
    const result = validateMensajeReceptorInput(noReason);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "detalleMensaje")).toBe(true);
  });

  it("rejects montoTotalImpuestoAcreditar exceeding montoTotalImpuesto", () => {
    const bad = { ...MENSAJE_ACEPTACION_TOTAL, montoTotalImpuestoAcreditar: 15000 };
    const result = validateMensajeReceptorInput(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "montoTotalImpuestoAcreditar")).toBe(true);
  });
});

describe("validateReciboPagoInput", () => {
  it("accepts standard ReciboElectronicoPago fixture", () => {
    expect(validateReciboPagoInput(SIMPLE_RECIBO_PAGO).valid).toBe(true);
  });

  it("rejects non-REP condicionVenta (e.g. 01)", () => {
    const bad = { ...SIMPLE_RECIBO_PAGO, condicionVenta: "01" as const };
    const result = validateReciboPagoInput(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "condicionVenta")).toBe(true);
  });

  it("rejects REP without informacionReferencia", () => {
    const { informacionReferencia: _, ...noRef } = SIMPLE_RECIBO_PAGO;
    const result = validateReciboPagoInput(noRef);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "informacionReferencia")).toBe(true);
  });
});

describe("validateFacturaCompraInput", () => {
  it("accepts standard FacturaElectronicaCompra fixture and supplier type 05/06", () => {
    expect(validateFacturaCompraInput(SIMPLE_FACTURA_COMPRA).valid).toBe(true);

    for (const tipo of ["05", "06"] as const) {
      const fec = structuredClone(SIMPLE_FACTURA_COMPRA);
      fec.emisor.identificacion = { tipo, numero: "EXT123456" };
      expect(validateFacturaCompraInput(fec).valid).toBe(true);
    }
  });

  it("rejects FEC without informacionReferencia", () => {
    const { informacionReferencia: _, ...noRef } = SIMPLE_FACTURA_COMPRA;
    const result = validateFacturaCompraInput(noRef);
    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.path === "informacionReferencia")).toBe(true);
  });

  it("rejects non-domestic receptor type 05/06 on FEC", () => {
    for (const tipo of ["05", "06"] as const) {
      const fec = structuredClone(SIMPLE_FACTURA_COMPRA);
      if (fec.receptor) {
        fec.receptor.identificacion = { tipo, numero: "EXT123456" };
      }
      const result = validateFacturaCompraInput(fec);
      expect(result.valid).toBe(false);
      expect(result.errors.some((issue) => issue.path === "receptor.identificacion.tipo")).toBe(
        true,
      );
    }
  });
});

describe("validateFacturaExportacionInput", () => {
  it("accepts standard FacturaElectronicaExportacion fixture with foreign buyer 05", () => {
    expect(validateFacturaExportacionInput(SIMPLE_FACTURA_EXPORTACION).valid).toBe(true);
  });

  it("rejects FEE with receptor type 06 or non-domestic emisor", () => {
    const badReceptor = structuredClone(SIMPLE_FACTURA_EXPORTACION);
    if (badReceptor.receptor) {
      badReceptor.receptor.identificacion = { tipo: "06", numero: "NC123456" };
    }
    const resReceptor = validateFacturaExportacionInput(badReceptor);
    expect(resReceptor.valid).toBe(false);
    expect(resReceptor.errors.some((issue) => issue.path === "receptor.identificacion.tipo")).toBe(
      true,
    );

    const badEmisor = structuredClone(SIMPLE_FACTURA_EXPORTACION);
    badEmisor.emisor.identificacion = { tipo: "05", numero: "EXT123456" };
    const resEmisor = validateFacturaExportacionInput(badEmisor);
    expect(resEmisor.valid).toBe(false);
    expect(resEmisor.errors.some((issue) => issue.path === "emisor.identificacion.tipo")).toBe(
      true,
    );
  });
});
