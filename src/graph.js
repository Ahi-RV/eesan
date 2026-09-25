const GRAPH = 'https://graph.microsoft.com/v1.0';
class GraphError extends Error { constructor(message, status = 502) { super(message); this.status = status; } }
class GraphClient {
  constructor(tokens, oauth) { this.tokens = tokens; this.oauth = oauth; }
  async request(path) {
    const response = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${this.tokens.access_token}` } });
    if (!response.ok) throw new GraphError(`Microsoft Graph request failed: ${response.status}`, response.status === 401 ? 401 : 502);
    return response.json();
  }
  async profile() { return this.request('/me?$select=id,displayName,userPrincipalName'); }
  async childByName(parentId, name) {
    const data = await this.request(`/me/drive/items/${parentId}/children?$select=id,name,folder,file,webUrl,size,lastModifiedDateTime&$top=999`);
    return data.value.find((item) => item.name.toLowerCase() === name.toLowerCase() && item.folder);
  }
  async listDescendants(folder, displayPath) {
    const files = []; let next = `${GRAPH}/me/drive/items/${folder.id}/children?$select=id,name,file,folder,webUrl,size,lastModifiedDateTime&$top=999`;
    while (next) {
      const response = await fetch(next, { headers: { Authorization: `Bearer ${this.tokens.access_token}` } });
      if (!response.ok) throw new GraphError(`Microsoft Graph request failed: ${response.status}`, 502);
      const page = await response.json();
      for (const item of page.value) {
        if (item.folder) files.push(...await this.listDescendants(item, `${displayPath}/${item.name}`));
        else if (item.file && item.name.toLowerCase().endsWith('.pdf')) files.push({ id: item.id, name: item.name, path: `${displayPath}/${item.name}`, webUrl: item.webUrl, size: item.size, lastModifiedDateTime: item.lastModifiedDateTime });
      }
      next = page['@odata.nextLink'];
    }
    return files;
  }
  async discoverPdfs(rootName) {
    const root = await this.childByName('root', rootName);
    if (!root) throw new GraphError(`The /${rootName} folder was not found in this OneDrive.`, 404);
    // One central library: optional subfolders are included automatically.
    const files = await this.listDescendants(root, `/${rootName}`);
    return { files, folders: [`/${rootName}`], missingFolders: [] };
  }
}
module.exports = { GraphClient, GraphError };

