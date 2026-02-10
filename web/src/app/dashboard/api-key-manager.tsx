"use client";

import { useState } from "react";

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export function ApiKeyManager({
  existingKeys,
}: {
  existingKeys: ApiKey[];
}) {
  const [keys, setKeys] = useState(existingKeys);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createKey() {
    if (!newKeyName.trim()) return;
    setLoading(true);

    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName }),
      });

      if (!res.ok) throw new Error("Failed to create key");

      const data = await res.json();
      setNewKeyValue(data.key);
      setKeys((prev) => [
        ...prev,
        {
          id: data.id,
          name: newKeyName,
          keyPrefix: data.prefix,
          createdAt: new Date(),
          lastUsedAt: null,
          expiresAt: null,
        },
      ]);
      setNewKeyName("");
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function revokeKey(keyId: string) {
    try {
      const res = await fetch(`/api/keys/${keyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to revoke key");
      setKeys((prev) => prev.filter((k) => k.id !== keyId));
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div>
      {/* Create new key */}
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Key name (e.g. 'claude-code')"
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm focus:outline-none focus:border-zinc-500"
        />
        <button
          onClick={createKey}
          disabled={loading || !newKeyName.trim()}
          className="px-4 py-2 bg-white text-black rounded-lg text-sm font-medium hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          Create Key
        </button>
      </div>

      {/* Show newly created key */}
      {newKeyValue && (
        <div className="mb-6 p-4 bg-green-900/20 border border-green-800 rounded-lg">
          <p className="text-sm text-green-400 mb-2 font-medium">
            Key created! Copy it now -- it won&apos;t be shown again.
          </p>
          <code className="block text-sm bg-black p-3 rounded font-mono break-all select-all">
            {newKeyValue}
          </code>
          <button
            onClick={() => setNewKeyValue(null)}
            className="mt-2 text-xs text-zinc-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Existing keys */}
      {keys.length === 0 ? (
        <p className="text-sm text-zinc-500">No API keys yet.</p>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <div
              key={key.id}
              className="flex items-center justify-between p-3 bg-zinc-900 rounded-lg border border-zinc-800"
            >
              <div>
                <p className="text-sm font-medium">{key.name}</p>
                <p className="text-xs text-zinc-500 font-mono">
                  {key.keyPrefix}...
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-500">
                  {key.lastUsedAt
                    ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                    : "Never used"}
                </span>
                <button
                  onClick={() => revokeKey(key.id)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
