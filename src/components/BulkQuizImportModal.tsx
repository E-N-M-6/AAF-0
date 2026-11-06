import React from "react";
import { QuizImporter, QuizImporterProps } from "./QuizImporter";

export type BulkQuizImportModalProps = QuizImporterProps;

export const BulkQuizImportModal: React.FC<BulkQuizImportModalProps> = (props) => {
  return <QuizImporter {...props} />;
};

export default BulkQuizImportModal;
