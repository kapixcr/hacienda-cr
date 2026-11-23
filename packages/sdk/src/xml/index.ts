/**
 * XML module — XML generation and validation for Hacienda v4.4.
 */

export { buildXml, getNamespaceUri, getSchemaFragment, type BuildXmlOptions } from "./builder.js";

export {
  validateFacturaInput,
  validateTiqueteInput,
  validateNotaCreditoInput,
  validateNotaDebitoInput,
  validateMensajeReceptorInput,
  validateReciboPagoInput,
  validateFacturaCompraInput,
  validateFacturaExportacionInput,
  type FacturaValidationError,
  type FacturaValidationResult,
  type NotaCreditoValidationOptions,
  type NotaDebitoValidationOptions,
} from "./validator.js";

export { validateDocumentXml, type DocumentXmlValidationResult } from "./schema-validator.js";
