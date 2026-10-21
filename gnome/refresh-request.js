import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTRIBUTES = 'standard::type,standard::is-symlink,standard::size,unix::uid,unix::mode';
const USER_ID = Gio.Credentials.new().get_unix_user();

function directory(root) {
    if (!GLib.path_is_absolute(root))
        throw new Error('Raiz privada inválida.');
    let parent = Gio.File.new_for_path('/');
    for (const component of root.split('/').filter(Boolean)) {
        if (component === '.' || component === '..')
            throw new Error('Caminho privado inválido.');
        parent = parent.get_child(component);
        const info = parent.query_info(ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
        if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error('Link em diretório privado.');
    }
    const rootInfo = parent.query_info(ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (rootInfo.get_attribute_uint32('unix::uid') !== USER_ID || (rootInfo.get_attribute_uint32('unix::mode') & 0o022))
        throw new Error('Raiz privada insegura.');
    const dir = parent.get_child('requests');
    try {
        dir.make_directory(null);
        dir.set_attribute_uint32('unix::mode', 0o700, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (error) {
        if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw error;
    }
    const info = dir.query_info(ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.DIRECTORY
        || info.get_attribute_uint32('unix::uid') !== USER_ID || (info.get_attribute_uint32('unix::mode') & 0o077))
        throw new Error('Diretório de pedidos inseguro.');
    return dir;
}

export function submitRefreshRequest(root, request, callback) {
    try {
        const time = Date.parse(request.createdAt);
        if (request.version !== 1 || !UUID.test(request.id) || !Number.isFinite(time)
            || Date.now() - time > 60000 || time > Date.now() + 5000)
            throw new Error('Pedido inválido.');
        const file = directory(root).get_child(`${request.id}.json`);
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(request)));
        file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null,
            (target, result) => {
                try {
                    target.replace_contents_finish(result);
                    callback(null);
                } catch (error) {
                    callback(error);
                }
            });
    } catch (error) {
        callback(error);
    }
}

export async function readRefreshResult(root, id) {
    if (!UUID.test(id))
        throw new Error('ID inválido.');
    const file = directory(root).get_child(`${id}.result.json`);
    let info;
    try {
        info = file.query_info(ATTRIBUTES, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    } catch (error) {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return null;
        throw error;
    }
    if (info.get_is_symlink() || info.get_file_type() !== Gio.FileType.REGULAR || info.get_size() > 65536
        || info.get_attribute_uint32('unix::uid') !== USER_ID || (info.get_attribute_uint32('unix::mode') & 0o077))
        throw new Error('Resultado privado inválido.');
    return new Promise((resolve, reject) => file.load_contents_async(null, (target, result) => {
        try {
            const [ok, contents] = target.load_contents_finish(result);
            if (!ok || contents.length > 65536)
                throw new Error('Resultado inválido.');
            const value = JSON.parse(new TextDecoder().decode(contents));
            if (value.id !== id || !Array.isArray(value.accounts))
                throw new Error('Resultado sem correlação.');
            resolve(value);
        } catch (error) {
            reject(error);
        }
    }));
}
