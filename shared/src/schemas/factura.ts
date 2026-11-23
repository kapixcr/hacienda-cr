/**
 * Zod schema for Factura Electronica (full electronic invoice) input
 * validation, per the v4.4 XSD.
 */

import { z } from "zod";
import { REFERENCE_CODES, REFERENCE_DOC_TYPES } from "../constants/index.js";
import {
  CURRENCY_CODES,
  IdentificationType,
  OTHER_CHARGE_TYPES,
  PaymentMethod,
  SaleCondition,
} from "../generated/index.js";
import {
  TaxCodeSchema,
  IvaRateCodeSchema,
  PaymentMethodSchema,
  SaleConditionSchema,
} from "./common.js";
import { EmisorSchema } from "./emisor.js";
import { ReceptorSchema } from "./receptor.js";
import { IdentificacionSchema } from "./identification.js";
import { LineaDetalleSchema } from "./linea-detalle.js";

/** Schema for currency information (CodigoTipoMoneda). */
export const CodigoTipoMonedaSchema = z.object({
  /** ISO 4217 currency code (official v4.4 catalog). */
  codigoMoneda: z.enum(CURRENCY_CODES),

  /** Exchange rate to CRC. Must be positive. */
  tipoCambio: z.number().positive(),
});

/** Schema for reference to another document (InformacionReferencia), v4.4. */
export const InformacionReferenciaSchema = z
  .object({
    /** Referenced document type code (TipoDocIR). */
    tipoDoc: z.enum(REFERENCE_DOC_TYPES),

    /** Free-text document type. Required when tipoDoc is "99" (5-100 chars). */
    tipoDocOtros: z.string().min(5).max(100).optional(),

    /** Referenced document clave or number. Optional, max 50 chars. */
    numero: z.string().min(1).max(50).optional(),

    /** Date of the referenced document (ISO 8601) — emitted as FechaEmisionIR. */
    fechaEmision: z.string().min(1),

    /** Reference reason code. Optional in v4.4. */
    codigo: z.enum(REFERENCE_CODES).optional(),

    /** Free-text reason code. Required when codigo is "99" (5-100 chars). */
    codigoOtros: z.string().min(5).max(100).optional(),

    /** Description of the reason. Optional, max 180 chars. */
    razon: z.string().min(1).max(180).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tipoDoc === "99" && !data.tipoDocOtros) {
      ctx.addIssue({
        code: "custom",
        message: 'tipoDocOtros is required when tipoDoc is "99"',
        path: ["tipoDocOtros"],
      });
    }
    if (data.codigo === "99" && !data.codigoOtros) {
      ctx.addIssue({
        code: "custom",
        message: 'codigoOtros is required when codigo is "99"',
        path: ["codigoOtros"],
      });
    }
  });

/** Schema for other charges (OtrosCargos), v4.4. */
export const OtroCargoSchema = z
  .object({
    /** Charge document type (TipoDocumentoOC). */
    tipoDocumento: z.enum(OTHER_CHARGE_TYPES),

    /** Free-text charge type. Required when tipoDocumento is "99" (5-100 chars). */
    tipoDocumentoOtros: z.string().min(5).max(100).optional(),

    /** Third-party identification. Optional. */
    identificacionTercero: IdentificacionSchema.optional(),

    /** Third-party name. Optional, 5-100 chars. */
    nombreTercero: z.string().min(5).max(100).optional(),

    /** Detail. Max 160 chars. */
    detalle: z.string().min(1).max(160),

    /** Percentage (PorcentajeOC). Optional. */
    porcentaje: z.number().min(0).max(100).optional(),

    /** Charge amount (MontoCargo). */
    montoCargo: z.number().min(0),
  })
  .superRefine((data, ctx) => {
    if (data.tipoDocumento === "99" && !data.tipoDocumentoOtros) {
      ctx.addIssue({
        code: "custom",
        message: 'tipoDocumentoOtros is required when tipoDocumento is "99"',
        path: ["tipoDocumentoOtros"],
      });
    }
    if (data.tipoDocumento === "04") {
      if (!data.identificacionTercero) {
        ctx.addIssue({
          code: "custom",
          message: 'identificacionTercero is required when tipoDocumento is "04"',
          path: ["identificacionTercero"],
        });
      }
      if (!data.nombreTercero) {
        ctx.addIssue({
          code: "custom",
          message: 'nombreTercero is required when tipoDocumento is "04"',
          path: ["nombreTercero"],
        });
      }
    }
  });

/** Schema for a payment-method entry inside ResumenFactura (v4.4). */
export const MedioPagoSchema = z.object({
  /** Payment method code (TipoMedioPago). */
  tipoMedioPago: PaymentMethodSchema,

  /** Free-text payment method. Required when tipo is "99" (3-100 chars). */
  medioPagoOtros: z.string().min(3).max(100).optional(),

  /** Amount paid with this method (TotalMedioPago). */
  totalMedioPago: z.number().min(0),
});

/** Schema for a per-tax-code total breakdown entry (v4.4). */
export const TotalDesgloseImpuestoSchema = z.object({
  /** Tax type code. */
  codigo: TaxCodeSchema,

  /** IVA rate code. Optional. */
  codigoTarifaIVA: IvaRateCodeSchema.optional(),

  /** Total tax amount for this (code, rate) pair. */
  totalMontoImpuesto: z.number().min(0),
});

/** Schema for invoice summary (ResumenFactura), v4.4. */
export const ResumenFacturaSchema = z.object({
  /** Currency information. Optional in input (builders default to CRC / 1). */
  codigoTipoMoneda: CodigoTipoMonedaSchema.optional(),

  /** Total taxable services. */
  totalServGravados: z.number().min(0).optional(),

  /** Total exempt services. */
  totalServExentos: z.number().min(0).optional(),

  /** Total exonerated services. */
  totalServExonerado: z.number().min(0).optional(),

  /** Total non-subject services (v4.4). */
  totalServNoSujeto: z.number().min(0).optional(),

  /** Total taxable merchandise. */
  totalMercanciasGravadas: z.number().min(0).optional(),

  /** Total exempt merchandise. */
  totalMercanciasExentas: z.number().min(0).optional(),

  /** Total exonerated merchandise. */
  totalMercExonerada: z.number().min(0).optional(),

  /** Total non-subject merchandise (v4.4). */
  totalMercNoSujeta: z.number().min(0).optional(),

  /** Total taxable. */
  totalGravado: z.number().min(0).optional(),

  /** Total exempt. */
  totalExento: z.number().min(0).optional(),

  /** Total exonerated. */
  totalExonerado: z.number().min(0).optional(),

  /** Total non-subject (v4.4). */
  totalNoSujeto: z.number().min(0).optional(),

  /** Total sales (before tax). */
  totalVenta: z.number().min(0),

  /** Total discounts. */
  totalDescuentos: z.number().min(0).optional(),

  /** Net sales (totalVenta - totalDescuentos). */
  totalVentaNeta: z.number().min(0),

  /** Per-tax-code totals breakdown (v4.4). Optional. */
  totalDesgloseImpuesto: z.array(TotalDesgloseImpuestoSchema).optional(),

  /** Total tax. */
  totalImpuesto: z.number().min(0).optional(),

  /** Total tax assumed by issuer/factory (v4.4). */
  totalImpAsumEmisorFabrica: z.number().min(0).optional(),

  /** Total IVA returned. Optional. */
  totalIVADevuelto: z.number().min(0).optional(),

  /** Total other charges. Optional. */
  totalOtrosCargos: z.number().min(0).optional(),

  /** Payment methods with amounts (v4.4). Up to 4 entries. */
  medioPago: z.array(MedioPagoSchema).min(1).max(4).optional(),

  /** Grand total. */
  totalComprobante: z.number().min(0),
});

/** Schema for additional content (Otros). */
export const OtroContenidoSchema = z.object({
  contenido: z.string().min(1),
});

/** Shared base fields for Factura Electronica and Tiquete Electronico. */
const BaseDocumentoFields = {
  /** 50-character clave (taxpayer segment alphanumeric since April 2026). */
  clave: z
    .string()
    .length(50)
    .regex(/^\d{9}[A-Za-z0-9]{12}\d{29}$/),

  /** Invoicing-system provider identification (ProveedorSistemas). */
  proveedorSistemas: z.string().min(1).max(20),

  /** Issuer economic activity code (6 digits). */
  codigoActividadEmisor: z
    .string()
    .regex(
      /^(?:\d{6}|\d{4}\.\d)$/,
      "Activity code must be six digits or the issued CIIU4 format ####.#",
    ),

  /** Receiver economic activity code (6 digits). Optional. */
  codigoActividadReceptor: z
    .string()
    .regex(
      /^(?:\d{6}|\d{4}\.\d)$/,
      "Activity code must be six digits or the issued CIIU4 format ####.#",
    )
    .optional(),

  /** Sequential document number (20 chars). */
  numeroConsecutivo: z
    .string()
    .length(20)
    .regex(/^\d{20}$/),

  /** Emission date (ISO 8601 with timezone). */
  fechaEmision: z.string().min(1),

  /** Issuer information. */
  emisor: EmisorSchema.refine(
    (e) =>
      e.identificacion.tipo !== IdentificationType.EXTRANJERO_NO_DOMICILIADO &&
      e.identificacion.tipo !== IdentificationType.NO_CONTRIBUYENTE,
    {
      message: "Emisor identification type must be domestic (01-04)",
      path: ["identificacion", "tipo"],
    },
  ),

  /** Sale condition (v4.4 set — REP-only payment codes excluded). */
  condicionVenta: SaleConditionSchema,

  /** Free-text sale condition. Required when condicionVenta is "99" (5-100 chars). */
  condicionVentaOtros: z.string().min(5).max(100).optional(),

  /** Credit term in days. Required when condicionVenta is "02" or "10". */
  plazoCredito: z.string().optional(),

  /** Line items. At least one required, max 1000. */
  detalleServicio: z.array(LineaDetalleSchema).min(1).max(1000),

  /** Other charges. Optional, max 15. */
  otrosCargos: z.array(OtroCargoSchema).max(15).optional(),

  /** Invoice summary / totals. */
  resumenFactura: ResumenFacturaSchema,

  /** References to other documents. Optional, max 10. */
  informacionReferencia: z.array(InformacionReferenciaSchema).max(10).optional(),

  /** Additional content. Optional. */
  otros: z.array(OtroContenidoSchema).optional(),
};

function refineCommonDocumentFields(
  data: {
    condicionVenta: string;
    plazoCredito?: string;
    condicionVentaOtros?: string;
    resumenFactura: { medioPago?: { tipoMedioPago: string; medioPagoOtros?: string }[] };
    detalleServicio: { unidadMedida: string; unidadMedidaComercial?: string }[];
  },
  ctx: z.RefinementCtx,
): void {
  if (
    (data.condicionVenta === SaleCondition.CREDITO ||
      data.condicionVenta === SaleCondition.VENTA_CREDITO_IVA_90_DIAS) &&
    !data.plazoCredito
  ) {
    ctx.addIssue({
      code: "custom",
      message: `plazoCredito is required when condicionVenta is "${data.condicionVenta}"`,
      path: ["plazoCredito"],
    });
  }
  if (data.condicionVenta === SaleCondition.OTROS && !data.condicionVentaOtros) {
    ctx.addIssue({
      code: "custom",
      message: 'condicionVentaOtros is required when condicionVenta is "99"',
      path: ["condicionVentaOtros"],
    });
  }
  for (const [index, payment] of (data.resumenFactura.medioPago ?? []).entries()) {
    if (payment.tipoMedioPago === PaymentMethod.OTROS && !payment.medioPagoOtros) {
      ctx.addIssue({
        code: "custom",
        message: 'medioPagoOtros is required when tipoMedioPago is "99"',
        path: ["resumenFactura", "medioPago", index, "medioPagoOtros"],
      });
    }
  }
  for (const [index, line] of data.detalleServicio.entries()) {
    if (line.unidadMedida === "Otros" && !line.unidadMedidaComercial?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: 'unidadMedidaComercial is required when unidadMedida is "Otros"',
        path: ["detalleServicio", index, "unidadMedidaComercial"],
      });
    }
  }
}

/** Unrefined Factura Electronica object schema (for `.pick()`/`.omit()`). */
export const BaseFacturaElectronicaSchema = z.object({
  ...BaseDocumentoFields,
  /** Receiver information. Required for Factura (with identification). */
  receptor: ReceptorSchema.refine((r) => r.identificacion !== undefined, {
    message: "Receptor identification is required for Factura Electronica",
    path: ["identificacion"],
  })
    .refine((r) => r.identificacion?.tipo !== IdentificationType.NO_CONTRIBUYENTE, {
      message:
        "Receptor identification type '06' (No Contribuyente) is not valid for Factura Electronica; emit a Tiquete Electronico instead",
      path: ["identificacion", "tipo"],
    })
    .refine((r) => r.identificacion?.tipo !== IdentificationType.EXTRANJERO_NO_DOMICILIADO, {
      message:
        "Receptor identification type '05' (Extranjero No Domiciliado) is only valid for suppliers in Factura Electronica de Compra (FEC)",
      path: ["identificacion", "tipo"],
    }),
});

/** Schema for a full Factura Electronica input, per the v4.4 XSD. */
export const FacturaElectronicaSchema = BaseFacturaElectronicaSchema.superRefine(
  refineCommonDocumentFields,
);

export type FacturaElectronicaInput = z.infer<typeof FacturaElectronicaSchema>;

/** Schema for a Tiquete Electronico input, per the v4.4 XSD. */
export const TiqueteElectronicoSchema = z
  .object({
    ...BaseDocumentoFields,
    /** Receiver information. Must be omitted on Tiquete Electronico. */
    receptor: ReceptorSchema.optional(),
  })
  .superRefine((data, ctx) => {
    refineCommonDocumentFields(data, ctx);
    if (data.receptor !== undefined) {
      ctx.addIssue({
        code: "custom",
        message:
          "Tiquete Electronico must not include receptor; emit a Factura Electronica instead",
        path: ["receptor"],
      });
    }
  });

export type TiqueteElectronicoInput = z.infer<typeof TiqueteElectronicoSchema>;
