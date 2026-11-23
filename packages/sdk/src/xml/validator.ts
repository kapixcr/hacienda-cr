/**
 * Factura Electronica input validation.
 *
 * Validates a FacturaElectronicaInput against the Zod schema
 * and applies additional business rules that go beyond schema validation:
 * - Sequential line numbers
 * - Amount consistency (montoTotal = cantidad * precioUnitario, etc.)
 * - Tax amount accuracy
 * - Summary totals matching line item calculations
 * - At least one line item
 * - Valid tax code / rate combinations
 */

import type {
  FacturaElectronicaCompra,
  FacturaElectronicaExportacion,
  FacturaElectronicaInput,
  MensajeReceptor,
  ReciboElectronicoPago,
  TiqueteElectronicoInput,
} from "@dojocoding/hacienda-shared";
import {
  CODIGO_REFERENCIA_PAGO_COMPROBANTE,
  DocumentTypeCode,
  FacturaElectronicaSchema,
  IdentificationType,
  IvaRateCode,
  IVA_RATE_PERCENTAGES,
  MensajeReceptorCode,
  PaymentMethod,
  REP_REFERENCE_CODES,
  REP_SALE_CONDITIONS,
  SaleCondition,
  TaxCode,
  TiqueteElectronicoSchema,
} from "@dojocoding/hacienda-shared";
import { calculateTaxAmount, round5 } from "../tax/calculator.js";
import { validateDocumentIdentity } from "./document-identity.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single validation error with a path and message. */
export interface FacturaValidationError {
  /** Dot-separated path to the field (e.g., "detalleServicio.0.montoTotal"). */
  path: string;

  /** Human-readable error message. */
  message: string;
}

/** Result of validating a Factura Electronica input. */
export interface FacturaValidationResult {
  /** Whether the input is valid. */
  valid: boolean;

  /** List of validation errors (empty if valid). */
  errors: FacturaValidationError[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check whether two numbers are equal within a small tolerance.
 * Accounts for floating-point precision issues.
 */
function amountsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

/** Transitional IVA rate codes (Ley 9635), invalid for a new document. */
const TRANSITIONAL_IVA_RATE_CODES: readonly IvaRateCode[] = [
  IvaRateCode.TRANSITORIO_0,
  IvaRateCode.TRANSITORIO_4,
  IvaRateCode.TRANSITORIO_8,
];

/** IVA-related tax codes. */
const IVA_TAX_CODES: string[] = [
  TaxCode.IVA,
  TaxCode.IVA_CALCULO_ESPECIAL,
  TaxCode.IVA_BIENES_USADOS,
];

// ---------------------------------------------------------------------------
// Business Rule Validation
// ---------------------------------------------------------------------------

/**
 * Validate business rules on a parsed FacturaElectronicaInput.
 *
 * @returns Array of validation errors. Empty if all rules pass.
 */
function validateBusinessRules(
  input: FacturaElectronicaInput | TiqueteElectronicoInput,
  documentTypeCode: DocumentTypeCode = DocumentTypeCode.FACTURA_ELECTRONICA,
): FacturaValidationError[] {
  const errors: FacturaValidationError[] = validateDocumentIdentity(input, documentTypeCode);
  const isFec = documentTypeCode === DocumentTypeCode.FACTURA_ELECTRONICA_COMPRA;
  const isFee = documentTypeCode === DocumentTypeCode.FACTURA_ELECTRONICA_EXPORTACION;
  if (
    !isFec &&
    (input.emisor.identificacion.tipo === IdentificationType.EXTRANJERO_NO_DOMICILIADO ||
      input.emisor.identificacion.tipo === IdentificationType.NO_CONTRIBUYENTE)
  ) {
    errors.push({
      path: "emisor.identificacion.tipo",
      message: "Emisor identification type must be domestic (01-04)",
    });
  }
  if (documentTypeCode === DocumentTypeCode.TIQUETE_ELECTRONICO && input.receptor !== undefined) {
    errors.push({
      path: "receptor",
      message: "Tiquete Electronico must not include receptor; emit a Factura Electronica instead",
    });
  }
  if (documentTypeCode === DocumentTypeCode.FACTURA_ELECTRONICA || isFec) {
    if (!input.receptor?.identificacion)
      errors.push({
        path: "receptor.identificacion",
        message: "Receptor requires identificacion when the Receptor node is present",
      });
    if (input.receptor?.identificacion?.tipo === IdentificationType.NO_CONTRIBUYENTE) {
      errors.push({
        path: "receptor.identificacion.tipo",
        message:
          "Receptor identification type '06' (No Contribuyente) is not valid for Factura Electronica; emit a Tiquete Electronico instead",
      });
    }
  }
  if (
    !isFee &&
    input.receptor?.identificacion?.tipo === IdentificationType.EXTRANJERO_NO_DOMICILIADO
  ) {
    errors.push({
      path: "receptor.identificacion.tipo",
      message:
        "Receptor identification type '05' (Extranjero No Domiciliado) is only valid for suppliers in Factura Electronica de Compra (FEC) or foreign buyers in FEE",
    });
  }
  for (const [index, reference] of (input.informacionReferencia ?? []).entries()) {
    if ((reference.codigo as string | undefined) === CODIGO_REFERENCIA_PAGO_COMPROBANTE)
      errors.push({
        path: `informacionReferencia.${index}.codigo`,
        message: "Reference reason 17 is valid only for ReciboElectronicoPago",
      });
  }

  for (const [index, charge] of (input.otrosCargos ?? []).entries()) {
    if (charge.tipoDocumento === "99" && !charge.tipoDocumentoOtros) {
      errors.push({
        path: `otrosCargos.${index}.tipoDocumentoOtros`,
        message: 'tipoDocumentoOtros is required when tipoDocumento is "99"',
      });
    }
    if (charge.tipoDocumento === "04") {
      if (!charge.identificacionTercero) {
        errors.push({
          path: `otrosCargos.${index}.identificacionTercero`,
          message: 'identificacionTercero is required when tipoDocumento is "04"',
        });
      }
      if (!charge.nombreTercero) {
        errors.push({
          path: `otrosCargos.${index}.nombreTercero`,
          message: 'nombreTercero is required when tipoDocumento is "04"',
        });
      }
    }
  }

  // Rule: Sequential line numbers starting from 1
  let lineIndex = 0;
  for (const line of input.detalleServicio) {
    if (line.numeroLinea !== lineIndex + 1) {
      errors.push({
        path: `detalleServicio.${lineIndex}.numeroLinea`,
        message: `Line number must be ${lineIndex + 1} (sequential), got ${line.numeroLinea}`,
      });
    }
    lineIndex++;
  }

  // Rule: Line item amount consistency
  let sumLineImpuestoNeto = 0;

  lineIndex = 0;
  for (const line of input.detalleServicio) {
    const prefix = `detalleServicio.${lineIndex}`;

    if (line.unidadMedida === "Otros" && !line.unidadMedidaComercial?.trim()) {
      errors.push({
        path: `${prefix}.unidadMedidaComercial`,
        message: 'unidadMedidaComercial is required when unidadMedida is "Otros"',
      });
    }

    // montoTotal = cantidad * precioUnitario
    const expectedMontoTotal = round5(line.cantidad * line.precioUnitario);
    if (!amountsEqual(line.montoTotal, expectedMontoTotal)) {
      errors.push({
        path: `${prefix}.montoTotal`,
        message: `montoTotal (${line.montoTotal}) must equal cantidad * precioUnitario (${expectedMontoTotal})`,
      });
    }

    // subTotal = montoTotal - sum(descuentos)
    const totalDescuento = line.descuento
      ? round5(
          line.descuento.reduce(
            (sum: number, d: { montoDescuento: number }) => sum + d.montoDescuento,
            0,
          ),
        )
      : 0;
    if (totalDescuento > line.montoTotal + 0.001) {
      errors.push({
        path: `${prefix}.descuento`,
        message: `Total line discounts (${totalDescuento}) must not exceed montoTotal (${line.montoTotal})`,
      });
    }
    const expectedSubTotal = round5(line.montoTotal - totalDescuento);
    if (!amountsEqual(line.subTotal, expectedSubTotal)) {
      errors.push({
        path: `${prefix}.subTotal`,
        message: `subTotal (${line.subTotal}) must equal montoTotal - discounts (${expectedSubTotal})`,
      });
    }

    // Standard IVA bases include ISC and alcoholic/non-alcoholic beverage taxes.
    // Code 07 explicitly allows a separately supplied special base.
    const includesSpecificBase = line.impuesto?.some((tax) =>
      ["02", "04", "05"].includes(tax.codigo),
    );
    if (includesSpecificBase && !line.impuesto?.some((tax) => tax.codigo === "07")) {
      const expectedBase = round5(
        line.subTotal +
          (line.impuesto ?? []).reduce(
            (sum, tax) => sum + (["02", "04", "05"].includes(tax.codigo) ? tax.monto : 0),
            0,
          ),
      );
      if (line.baseImponible === undefined || !amountsEqual(line.baseImponible, expectedBase))
        errors.push({
          path: `${prefix}.baseImponible`,
          message: `Base imponible must include applicable specific taxes (${expectedBase})`,
        });
    }

    // Tax amount validation
    if (line.impuesto && line.impuesto.length > 0) {
      let lineImpuestoNeto = 0;
      let taxIndex = 0;

      for (const tax of line.impuesto) {
        // Keep existing non-rate regime validation unchanged outside codes 02–06.
        if (tax.tarifa !== undefined || ["02", "03", "04", "05", "06"].includes(tax.codigo)) {
          try {
            const expected = calculateTaxAmount(
              tax,
              IVA_TAX_CODES.includes(tax.codigo)
                ? (line.baseImponible ?? line.subTotal)
                : line.subTotal,
              line.cantidad,
            );
            if (!amountsEqual(tax.monto, expected))
              errors.push({
                path: `${prefix}.impuesto.${taxIndex}.monto`,
                message: `Tax amount must match its applicable calculation (${expected})`,
              });
          } catch (error) {
            errors.push({
              path: `${prefix}.impuesto.${taxIndex}.monto`,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // IVA tax codes must have codigoTarifaIVA
        if (IVA_TAX_CODES.includes(tax.codigo) && !tax.codigoTarifaIVA) {
          errors.push({
            path: `${prefix}.impuesto.${taxIndex}.codigoTarifaIVA`,
            message: `IVA tax (code ${tax.codigo}) must specify a codigoTarifaIVA (rate code)`,
          });
        }

        // Calculate net IVA for this tax
        if (tax.codigo === TaxCode.IVA && tax.codigoTarifaIVA) {
          const expectedRate = IVA_RATE_PERCENTAGES[tax.codigoTarifaIVA];
          if (expectedRate !== tax.tarifa)
            errors.push({
              path: `${prefix}.impuesto.${taxIndex}.tarifa`,
              message: `IVA tarifa must match codigoTarifaIVA ${tax.codigoTarifaIVA} (${expectedRate}%)`,
            });
          if (TRANSITIONAL_IVA_RATE_CODES.includes(tax.codigoTarifaIVA))
            errors.push({
              path: `${prefix}.impuesto.${taxIndex}.codigoTarifaIVA`,
              message:
                "Transitional IVA rate codes 05, 06 and 07 are not valid for a new FacturaElectronica",
            });
        }
        {
          let netAmount = tax.monto;
          if (tax.exoneracion) {
            if (tax.tarifa !== undefined && tax.exoneracion.tarifaExonerada > tax.tarifa) {
              errors.push({
                path: `${prefix}.impuesto.${taxIndex}.exoneracion.tarifaExonerada`,
                message: `tarifaExonerada (${tax.exoneracion.tarifaExonerada}) must not exceed tax tarifa (${tax.tarifa})`,
              });
            }
            if (tax.exoneracion.montoExoneracion > tax.monto + 0.001) {
              errors.push({
                path: `${prefix}.impuesto.${taxIndex}.exoneracion.montoExoneracion`,
                message: `montoExoneracion (${tax.exoneracion.montoExoneracion}) must not exceed tax monto (${tax.monto})`,
              });
            }
            netAmount = round5(netAmount - tax.exoneracion.montoExoneracion);
          }
          lineImpuestoNeto = round5(lineImpuestoNeto + netAmount);
        }

        taxIndex++;
      }

      // Validate impuestoNeto
      if (line.impuestoNeto !== undefined) {
        if (!amountsEqual(line.impuestoNeto, lineImpuestoNeto)) {
          errors.push({
            path: `${prefix}.impuestoNeto`,
            message: `impuestoNeto (${line.impuestoNeto}) must equal sum of net taxes (${lineImpuestoNeto})`,
          });
        }
      }

      sumLineImpuestoNeto = round5(sumLineImpuestoNeto + lineImpuestoNeto);
    }

    // montoTotalLinea = subTotal + impuestoNeto
    const impNeto = line.impuestoNeto ?? 0;
    const expectedMontoTotalLinea = round5(line.subTotal + impNeto);
    if (!amountsEqual(line.montoTotalLinea, expectedMontoTotalLinea)) {
      errors.push({
        path: `${prefix}.montoTotalLinea`,
        message: `montoTotalLinea (${line.montoTotalLinea}) must equal subTotal + impuestoNeto (${expectedMontoTotalLinea})`,
      });
    }

    lineIndex++;
  }

  // Reconcile the summary against detail lines, not just against itself.
  const detailTotals = {
    totalVenta: round5(input.detalleServicio.reduce((sum, line) => sum + line.montoTotal, 0)),
    totalDescuentos: round5(
      input.detalleServicio.reduce(
        (sum, line) =>
          sum + (line.descuento ?? []).reduce((n, discount) => n + discount.montoDescuento, 0),
        0,
      ),
    ),
    totalVentaNeta: round5(input.detalleServicio.reduce((sum, line) => sum + line.subTotal, 0)),
    totalOtrosCargos: round5(
      (input.otrosCargos ?? []).reduce((sum, charge) => sum + charge.montoCargo, 0),
    ),
  };
  for (const [field, expected] of Object.entries(detailTotals)) {
    const actual = input.resumenFactura[field as keyof typeof detailTotals] ?? 0;
    if (!amountsEqual(actual, expected)) {
      errors.push({
        path: `resumenFactura.${field}`,
        message: `${field} (${actual}) must match detail amounts (${expected})`,
      });
    }
  }

  // Rule: Summary total consistency (v4.4: most totals are optional)
  const r = input.resumenFactura;

  // totalGravado = totalServGravados + totalMercanciasGravadas
  if (r.totalGravado !== undefined) {
    const expectedTotalGravado = round5(
      (r.totalServGravados ?? 0) + (r.totalMercanciasGravadas ?? 0),
    );
    if (!amountsEqual(r.totalGravado, expectedTotalGravado)) {
      errors.push({
        path: "resumenFactura.totalGravado",
        message: `totalGravado (${r.totalGravado}) must equal totalServGravados + totalMercanciasGravadas (${expectedTotalGravado})`,
      });
    }
  }

  // totalExento = totalServExentos + totalMercanciasExentas
  if (r.totalExento !== undefined) {
    const expectedTotalExento = round5((r.totalServExentos ?? 0) + (r.totalMercanciasExentas ?? 0));
    if (!amountsEqual(r.totalExento, expectedTotalExento)) {
      errors.push({
        path: "resumenFactura.totalExento",
        message: `totalExento (${r.totalExento}) must equal totalServExentos + totalMercanciasExentas (${expectedTotalExento})`,
      });
    }
  }

  // totalExonerado (if present)
  if (r.totalExonerado !== undefined) {
    const expectedTotalExonerado = round5(
      (r.totalServExonerado ?? 0) + (r.totalMercExonerada ?? 0),
    );
    if (!amountsEqual(r.totalExonerado, expectedTotalExonerado)) {
      errors.push({
        path: "resumenFactura.totalExonerado",
        message: `totalExonerado (${r.totalExonerado}) must equal totalServExonerado + totalMercExonerada (${expectedTotalExonerado})`,
      });
    }
  }

  // totalVenta = totalGravado + totalExento + totalExonerado + totalNoSujeto
  const totalExonerado = r.totalExonerado ?? 0;
  const expectedTotalVenta = round5(
    (r.totalGravado ?? 0) + (r.totalExento ?? 0) + totalExonerado + (r.totalNoSujeto ?? 0),
  );
  if (!amountsEqual(r.totalVenta, expectedTotalVenta)) {
    errors.push({
      path: "resumenFactura.totalVenta",
      message: `totalVenta (${r.totalVenta}) must equal totalGravado + totalExento + totalExonerado + totalNoSujeto (${expectedTotalVenta})`,
    });
  }

  // totalVentaNeta = totalVenta - totalDescuentos
  const expectedTotalVentaNeta = round5(r.totalVenta - (r.totalDescuentos ?? 0));
  if (!amountsEqual(r.totalVentaNeta, expectedTotalVentaNeta)) {
    errors.push({
      path: "resumenFactura.totalVentaNeta",
      message: `totalVentaNeta (${r.totalVentaNeta}) must equal totalVenta - totalDescuentos (${expectedTotalVentaNeta})`,
    });
  }

  // totalImpuesto must match the sum of line item impuestoNeto values, and
  // may only be omitted when the lines carry no tax at all.
  if (r.totalImpuesto !== undefined) {
    if (!amountsEqual(r.totalImpuesto, sumLineImpuestoNeto)) {
      errors.push({
        path: "resumenFactura.totalImpuesto",
        message: `totalImpuesto (${r.totalImpuesto}) must equal sum of line item impuestoNeto (${sumLineImpuestoNeto})`,
      });
    }
  } else if (sumLineImpuestoNeto > 0) {
    errors.push({
      path: "resumenFactura.totalImpuesto",
      message: `totalImpuesto is required when line items carry tax (sum of impuestoNeto is ${sumLineImpuestoNeto})`,
    });
  }

  // totalComprobante = totalVentaNeta + totalImpuesto + totalOtrosCargos - totalIVADevuelto
  const totalOtrosCargos = r.totalOtrosCargos ?? 0;
  const totalIVADevuelto = r.totalIVADevuelto ?? 0;
  const expectedTotalComprobante = round5(
    r.totalVentaNeta + (r.totalImpuesto ?? 0) + totalOtrosCargos - totalIVADevuelto,
  );
  if (!amountsEqual(r.totalComprobante, expectedTotalComprobante)) {
    errors.push({
      path: "resumenFactura.totalComprobante",
      message: `totalComprobante (${r.totalComprobante}) must equal totalVentaNeta + totalImpuesto + totalOtrosCargos - totalIVADevuelto (${expectedTotalComprobante})`,
    });
  }

  // Rule: plazoCredito required when condicionVenta is "02" (credit) or "10" (90-day IVA credit)
  if (
    (input.condicionVenta === SaleCondition.CREDITO ||
      input.condicionVenta === SaleCondition.VENTA_CREDITO_IVA_90_DIAS) &&
    !input.plazoCredito
  ) {
    errors.push({
      path: "plazoCredito",
      message: `plazoCredito is required when condicionVenta is "${input.condicionVenta}"`,
    });
  }

  // Rule: condicionVentaOtros required when condicionVenta is "99" (Otros)
  if (input.condicionVenta === SaleCondition.OTROS && !input.condicionVentaOtros) {
    errors.push({
      path: "condicionVentaOtros",
      message: 'condicionVentaOtros is required when condicionVenta is "99" (Otros)',
    });
  }

  // Rule: medioPagoOtros required when tipoMedioPago is "99" (Otros)
  for (const [index, payment] of (r.medioPago ?? []).entries()) {
    if (payment.tipoMedioPago === PaymentMethod.OTROS && !payment.medioPagoOtros) {
      errors.push({
        path: `resumenFactura.medioPago.${index}.medioPagoOtros`,
        message: 'medioPagoOtros is required when tipoMedioPago is "99" (Otros)',
      });
    }
  }

  // Rule: for cash sales ("01"), sum of medioPago amounts must match totalComprobante when medioPago is provided
  if (input.condicionVenta === SaleCondition.CONTADO && r.medioPago && r.medioPago.length > 0) {
    const sumMedioPago = round5(r.medioPago.reduce((acc, p) => acc + p.totalMedioPago, 0));
    if (!amountsEqual(sumMedioPago, r.totalComprobante)) {
      errors.push({
        path: "resumenFactura.medioPago",
        message: `Sum of totalMedioPago (${sumMedioPago}) must equal totalComprobante (${r.totalComprobante}) for Contado sales`,
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a Factura Electronica input.
 *
 * Performs two levels of validation:
 * 1. **Schema validation** — using the Zod FacturaElectronicaSchema
 * 2. **Business rule validation** — amount consistency, sequential line
 *    numbers, tax calculations, summary totals matching
 *
 * @param input - The factura input to validate (can be any unknown value).
 * @returns A result object indicating whether the input is valid,
 *   with detailed errors if not.
 *
 * @example
 * ```ts
 * const result = validateFacturaInput(myInvoiceData);
 * if (!result.valid) {
 *   console.error("Validation errors:", result.errors);
 * }
 * ```
 */
export function validateFacturaInput(input: unknown): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];

  // Step 1: Zod schema validation
  const parseResult = FacturaElectronicaSchema.safeParse(input);

  if (!parseResult.success) {
    // Convert Zod errors to our format
    for (const issue of parseResult.error.issues) {
      errors.push({
        path: issue.path.map(String).join("."),
        message: issue.message,
      });
    }

    return { valid: false, errors };
  }

  // Step 2: Business rule validation (only if schema passes)
  const businessErrors = validateBusinessRules(
    parseResult.data,
    DocumentTypeCode.FACTURA_ELECTRONICA,
  );
  errors.push(...businessErrors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a Tiquete Electronico input.
 *
 * Applies the same schema and business-rule validation as `validateFacturaInput`,
 * except `receptor` and `receptor.identificacion` are optional and identification
 * type `"06"` (No Contribuyente) is permitted on `receptor`.
 */
export function validateTiqueteInput(input: unknown): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];

  const parseResult = TiqueteElectronicoSchema.safeParse(input);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      errors.push({
        path: issue.path.map(String).join("."),
        message: issue.message,
      });
    }
    return { valid: false, errors };
  }

  errors.push(...validateBusinessRules(parseResult.data, DocumentTypeCode.TIQUETE_ELECTRONICO));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Optional original-document context for validating a Nota de Credito or Nota de Debito. */
export interface NotaCreditoValidationOptions {
  /** Total amount (`totalComprobante`) of the original referenced document. */
  originalTotalComprobante?: number;
  /** 50-digit clave of the original referenced document. */
  originalClave?: string;
}

/** Optional original-document context for validating a Nota de Debito. */
export type NotaDebitoValidationOptions = NotaCreditoValidationOptions;

const NC_ALLOWED_REFERENCE_DOC_TYPES = new Set(["01", "02", "04"]);
const ND_ALLOWED_REFERENCE_DOC_TYPES = new Set(["01", "03", "04"]);

function validateReferencedDocumentInput(
  input: unknown,
  config: {
    docLabel: string;
    documentTypeCode: DocumentTypeCode;
    allowedReferenceDocTypes: ReadonlySet<string>;
    allowedTypesMessage: string;
  },
  options?: NotaCreditoValidationOptions,
): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ path: "", message: `${config.docLabel} input must be an object` }],
    };
  }

  const doc = input as Partial<FacturaElectronicaInput>;
  const refs = doc.informacionReferencia ?? [];
  if (refs.length === 0) {
    errors.push({
      path: "informacionReferencia",
      message: `${config.docLabel} requires at least one informacionReferencia entry`,
    });
  }

  for (const [index, ref] of refs.entries()) {
    if (!config.allowedReferenceDocTypes.has(ref.tipoDoc)) {
      errors.push({
        path: `informacionReferencia.${index}.tipoDoc`,
        message: config.allowedTypesMessage,
      });
    }
    if (!ref.numero || !/^\d{50}$/.test(ref.numero)) {
      errors.push({
        path: `informacionReferencia.${index}.numero`,
        message: `${config.docLabel} reference requires the 50-digit clave of the original document`,
      });
    }
    if (!ref.codigo) {
      errors.push({
        path: `informacionReferencia.${index}.codigo`,
        message: `${config.docLabel} reference requires a reason codigo`,
      });
    }
    if (!ref.razon) {
      errors.push({
        path: `informacionReferencia.${index}.razon`,
        message: `${config.docLabel} reference requires a razon`,
      });
    }
  }

  if (options?.originalClave !== undefined) {
    if (doc.clave === options.originalClave) {
      errors.push({
        path: "clave",
        message: `${config.docLabel} clave must differ from the original document clave`,
      });
    }
    if (refs[0] && refs[0].numero !== options.originalClave) {
      errors.push({
        path: "informacionReferencia.0.numero",
        message: `${config.docLabel} reference numero must match the original document clave`,
      });
    }
  }

  const totalComprobante = doc.resumenFactura?.totalComprobante;
  if (
    options?.originalTotalComprobante !== undefined &&
    typeof totalComprobante === "number" &&
    totalComprobante > options.originalTotalComprobante + 0.001
  ) {
    errors.push({
      path: "resumenFactura.totalComprobante",
      message: `${config.docLabel} totalComprobante (${totalComprobante}) must not exceed original document total (${options.originalTotalComprobante})`,
    });
  }

  if (doc.clave && doc.numeroConsecutivo && doc.fechaEmision) {
    errors.push(
      ...validateDocumentIdentity(doc as FacturaElectronicaInput, config.documentTypeCode),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a Nota de Credito Electronica input.
 *
 * Enforces NC-specific rules:
 * - At least one `informacionReferencia` entry
 * - Referenced `tipoDoc` must be FE (`01`), ND (`02`), or TE (`04`)
 * - Referenced `numero` (50-digit original clave), `codigo`, and `razon` are required
 * - Optional cap check: NC `totalComprobante` must not exceed `originalTotalComprobante`
 * - Optional original clave match (`originalClave`) and distinct NC clave
 */
export function validateNotaCreditoInput(
  input: unknown,
  options?: NotaCreditoValidationOptions,
): FacturaValidationResult {
  return validateReferencedDocumentInput(
    input,
    {
      docLabel: "Nota de Credito",
      documentTypeCode: DocumentTypeCode.NOTA_CREDITO_ELECTRONICA,
      allowedReferenceDocTypes: NC_ALLOWED_REFERENCE_DOC_TYPES,
      allowedTypesMessage:
        "Nota de Credito can only reference Factura (01), Nota de Debito (02), or Tiquete (04)",
    },
    options,
  );
}

/**
 * Validate a Nota de Debito Electronica input.
 *
 * Enforces ND-specific rules:
 * - At least one `informacionReferencia` entry
 * - Referenced `tipoDoc` must be FE (`01`), NC (`03`), or TE (`04`)
 * - Referenced `numero` (50-digit original clave), `codigo`, and `razon` are required
 * - Optional cap check: ND `totalComprobante` must not exceed `originalTotalComprobante`
 * - Optional original clave match (`originalClave`) and distinct ND clave
 */
export function validateNotaDebitoInput(
  input: unknown,
  options?: NotaDebitoValidationOptions,
): FacturaValidationResult {
  return validateReferencedDocumentInput(
    input,
    {
      docLabel: "Nota de Debito",
      documentTypeCode: DocumentTypeCode.NOTA_DEBITO_ELECTRONICA,
      allowedReferenceDocTypes: ND_ALLOWED_REFERENCE_DOC_TYPES,
      allowedTypesMessage:
        "Nota de Debito can only reference Factura (01), Nota de Credito (03), or Tiquete (04)",
    },
    options,
  );
}

const MR_CONSECUTIVE_KIND: Record<string, string> = {
  [MensajeReceptorCode.ACEPTADO]: "05",
  [MensajeReceptorCode.ACEPTADO_PARCIALMENTE]: "06",
  [MensajeReceptorCode.RECHAZADO]: "07",
};
const MR_CONDICION_IMPUESTO = new Set(["01", "02", "03", "04", "05"]);

/**
 * Validate a MensajeReceptor input.
 *
 * Checks clave, emisor/receptor IDs, mensaje code (1/2/3), matching consecutive
 * document type (05/06/07), required detalleMensaje for partial acceptance/rejection,
 * tax condition codes (01-05), and creditable/expense amount bounds.
 */
export function validateMensajeReceptorInput(input: unknown): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ path: "", message: "MensajeReceptor input must be an object" }],
    };
  }

  const mr = input as Partial<MensajeReceptor>;
  if (!mr.clave || !/^\d{9}[A-Za-z0-9]{12}\d{29}$/.test(mr.clave)) {
    errors.push({ path: "clave", message: "clave must be a valid 50-character Hacienda key" });
  }
  if (!mr.numeroCedulaEmisor || mr.numeroCedulaEmisor.length > 20) {
    errors.push({
      path: "numeroCedulaEmisor",
      message: "numeroCedulaEmisor is required (max 20 chars)",
    });
  }
  if (!mr.numeroCedulaReceptor || mr.numeroCedulaReceptor.length > 20) {
    errors.push({
      path: "numeroCedulaReceptor",
      message: "numeroCedulaReceptor is required (max 20 chars)",
    });
  }
  if (!mr.fechaEmisionDoc) {
    errors.push({ path: "fechaEmisionDoc", message: "fechaEmisionDoc is required" });
  }

  const expectedKind = mr.mensaje ? MR_CONSECUTIVE_KIND[mr.mensaje] : undefined;
  if (!expectedKind) {
    errors.push({
      path: "mensaje",
      message: 'mensaje must be "1" (Aceptado), "2" (Aceptado Parcialmente), or "3" (Rechazado)',
    });
  }
  if (!mr.numeroConsecutivoReceptor || !/^\d{20}$/.test(mr.numeroConsecutivoReceptor)) {
    errors.push({
      path: "numeroConsecutivoReceptor",
      message: "numeroConsecutivoReceptor must be exactly 20 digits",
    });
  } else if (expectedKind && mr.numeroConsecutivoReceptor.slice(8, 10) !== expectedKind) {
    errors.push({
      path: "numeroConsecutivoReceptor",
      message: `numeroConsecutivoReceptor positions 9-10 must be "${expectedKind}" for mensaje "${mr.mensaje}"`,
    });
  }

  if (
    mr.mensaje !== undefined &&
    mr.mensaje !== MensajeReceptorCode.ACEPTADO &&
    (!mr.detalleMensaje || mr.detalleMensaje.trim().length < 5 || mr.detalleMensaje.length > 160)
  ) {
    errors.push({
      path: "detalleMensaje",
      message: "detalleMensaje (5-160 chars) is required for partial acceptance or rejection",
    });
  }
  if (mr.condicionImpuesto !== undefined && !MR_CONDICION_IMPUESTO.has(mr.condicionImpuesto)) {
    errors.push({
      path: "condicionImpuesto",
      message: "condicionImpuesto must be one of 01, 02, 03, 04, 05",
    });
  }
  if (mr.codigoActividad !== undefined && !/^(?:\d{6}|\d{4}\.\d)$/.test(mr.codigoActividad)) {
    errors.push({
      path: "codigoActividad",
      message: "codigoActividad must be 6 digits or CIIU4 format ####.#",
    });
  }
  if (typeof mr.totalFactura !== "number" || mr.totalFactura < 0) {
    errors.push({ path: "totalFactura", message: "totalFactura must be a non-negative number" });
  }
  if (
    mr.montoTotalImpuestoAcreditar !== undefined &&
    mr.montoTotalImpuesto !== undefined &&
    mr.montoTotalImpuestoAcreditar > mr.montoTotalImpuesto + 0.001
  ) {
    errors.push({
      path: "montoTotalImpuestoAcreditar",
      message: `montoTotalImpuestoAcreditar (${mr.montoTotalImpuestoAcreditar}) must not exceed montoTotalImpuesto (${mr.montoTotalImpuesto})`,
    });
  }
  if (
    mr.montoTotalDeGastoAplicable !== undefined &&
    typeof mr.totalFactura === "number" &&
    mr.montoTotalDeGastoAplicable > mr.totalFactura + 0.001
  ) {
    errors.push({
      path: "montoTotalDeGastoAplicable",
      message: `montoTotalDeGastoAplicable (${mr.montoTotalDeGastoAplicable}) must not exceed totalFactura (${mr.totalFactura})`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

const REP_ALLOWED_SALE_CONDITIONS = new Set<string>(REP_SALE_CONDITIONS);
const REP_ALLOWED_REFERENCE_CODES = new Set<string>(REP_REFERENCE_CODES);

/**
 * Validate a ReciboElectronicoPago (REP) input.
 *
 * Enforces REP-specific rules:
 * - Document identity must be type `"10"` (RECIBO_ELECTRONICO_PAGO)
 * - `condicionVenta` must be `"09"` or `"11"` (REP_SALE_CONDITIONS)
 * - At least one `informacionReferencia` entry with 50-digit `numero` and valid REP `codigo` (including `"17"`)
 * - At least one line item and at least one `medioPago` entry
 */
export function validateReciboPagoInput(input: unknown): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ path: "", message: "ReciboElectronicoPago input must be an object" }],
    };
  }

  const rep = input as Partial<ReciboElectronicoPago>;
  if (!rep.condicionVenta || !REP_ALLOWED_SALE_CONDITIONS.has(rep.condicionVenta)) {
    errors.push({
      path: "condicionVenta",
      message: 'ReciboElectronicoPago condicionVenta must be "09" or "11"',
    });
  }

  const refs = rep.informacionReferencia ?? [];
  if (refs.length === 0) {
    errors.push({
      path: "informacionReferencia",
      message: "ReciboElectronicoPago requires at least one informacionReferencia entry",
    });
  }
  for (const [index, ref] of refs.entries()) {
    if (!ref.numero || !/^\d{50}$/.test(ref.numero)) {
      errors.push({
        path: `informacionReferencia.${index}.numero`,
        message: "ReciboElectronicoPago reference requires the 50-digit clave of the paid document",
      });
    }
    if (ref.codigo !== undefined && !REP_ALLOWED_REFERENCE_CODES.has(ref.codigo)) {
      errors.push({
        path: `informacionReferencia.${index}.codigo`,
        message: `Invalid reference codigo "${ref.codigo}" for ReciboElectronicoPago`,
      });
    }
  }

  if (!rep.detalleServicio || rep.detalleServicio.length === 0) {
    errors.push({
      path: "detalleServicio",
      message: "ReciboElectronicoPago requires at least one detalleServicio line",
    });
  }
  if (!rep.resumenFactura?.medioPago || rep.resumenFactura.medioPago.length === 0) {
    errors.push({
      path: "resumenFactura.medioPago",
      message: "ReciboElectronicoPago requires at least one medioPago entry",
    });
  }

  if (rep.clave && rep.numeroConsecutivo && rep.fechaEmision) {
    errors.push(
      ...validateDocumentIdentity(
        rep as FacturaElectronicaInput,
        DocumentTypeCode.RECIBO_ELECTRONICO_PAGO,
      ),
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a FacturaElectronicaCompra (FEC) input.
 *
 * Enforces FEC-specific rules:
 * - Document identity must be type `"08"` (FACTURA_ELECTRONICA_COMPRA)
 * - `emisor` (supplier) may use `"01"`–`"06"` (including `"05"` foreign non-domiciled and `"06"` non-taxpayer)
 * - `receptor` (buyer/issuer) must be domestic (`"01"`–`"04"`)
 * - At least one `informacionReferencia` entry is required
 * - Reuses line-item, tax, discount, charge, payment, and summary consistency rules
 */
export function validateFacturaCompraInput(input: unknown): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ path: "", message: "FacturaElectronicaCompra input must be an object" }],
    };
  }

  const fec = input as Partial<FacturaElectronicaCompra>;
  if (!fec.informacionReferencia || fec.informacionReferencia.length === 0) {
    errors.push({
      path: "informacionReferencia",
      message: "FacturaElectronicaCompra requires at least one informacionReferencia entry",
    });
  }
  if (
    fec.clave &&
    fec.numeroConsecutivo &&
    fec.fechaEmision &&
    fec.emisor &&
    fec.receptor &&
    fec.detalleServicio &&
    fec.resumenFactura
  ) {
    errors.push(
      ...validateBusinessRules(
        fec as unknown as FacturaElectronicaInput,
        DocumentTypeCode.FACTURA_ELECTRONICA_COMPRA,
      ),
    );
  } else {
    errors.push({
      path: "",
      message: "FacturaElectronicaCompra is missing required document fields",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a FacturaElectronicaExportacion (FEE) input.
 *
 * Enforces FEE-specific rules:
 * - Document identity must be type `"09"` (FACTURA_ELECTRONICA_EXPORTACION)
 * - `emisor` must be domestic (`"01"`–`"04"`)
 * - `receptor` is required and allows foreign buyer identification (`"05"`)
 * - Reuses line-item, tax, discount, charge, payment, and summary consistency rules
 */
export function validateFacturaExportacionInput(input: unknown): FacturaValidationResult {
  const errors: FacturaValidationError[] = [];
  if (!input || typeof input !== "object") {
    return {
      valid: false,
      errors: [{ path: "", message: "FacturaElectronicaExportacion input must be an object" }],
    };
  }

  const fee = input as Partial<FacturaElectronicaExportacion>;
  if (!fee.receptor) {
    errors.push({
      path: "receptor",
      message: "FacturaElectronicaExportacion requires receptor",
    });
  }
  if (fee.receptor?.identificacion?.tipo === IdentificationType.NO_CONTRIBUYENTE) {
    errors.push({
      path: "receptor.identificacion.tipo",
      message:
        "Receptor identification type '06' (No Contribuyente) is not valid for FacturaElectronicaExportacion",
    });
  }
  if (
    fee.clave &&
    fee.numeroConsecutivo &&
    fee.fechaEmision &&
    fee.emisor &&
    fee.receptor &&
    fee.detalleServicio &&
    fee.resumenFactura
  ) {
    errors.push(
      ...validateBusinessRules(
        fee as unknown as FacturaElectronicaInput,
        DocumentTypeCode.FACTURA_ELECTRONICA_EXPORTACION,
      ),
    );
  } else {
    errors.push({
      path: "",
      message: "FacturaElectronicaExportacion is missing required document fields",
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
