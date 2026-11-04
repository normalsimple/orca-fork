// F051: every document preview may read its whole request base (the workspace, or for a document
// outside every workspace the host's filesystem root), so upstream's folder prompt never shows.
import {
  authorizeDocPreviewDirectory,
  getDocPreviewGrant
} from '../../main/browser/document-preview/doc-preview-grant-registry'

export function openWholeRequestBase(grantId: string): void {
  const grant = getDocPreviewGrant(grantId)
  if (!grant) {
    return
  }
  // Authorizing names a file and allows its folder; the entry's first segment sits in the base.
  authorizeDocPreviewDirectory(grant.id, grant.entryRelativePath.split('/')[0])
}
