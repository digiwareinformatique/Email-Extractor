import os
import zipfile
import sys

def create_project_zip(output_path='whatsapp-sender-project.zip'):
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) if 'scripts' in os.path.dirname(os.path.abspath(__file__)) else os.getcwd()
    
    exclude_dirs = {
        'node_modules',
        'dist',
        '.git',
        '.cache',
        'wwebjs_auth',
        '.vscode',
        '.idea',
        'coverage'
    }
    
    exclude_files = {
        'whatsapp-sender.zip',
        'whatsapp-sender.tar.gz',
        'whatsapp-sender-project.zip',
        '.DS_Store'
    }

    target_zip = os.path.join(root_dir, output_path)
    print(f"Creating archive at: {target_zip} from root: {root_dir}")
    
    file_count = 0
    with zipfile.ZipFile(target_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(root_dir):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs and not d.startswith('.')]
            
            # Avoid packing sessions / auth data
            if 'wwebjs_auth' in root or 'sessions' in root:
                continue

            for file in files:
                if file in exclude_files or file.endswith('.zip') or file.endswith('.tar.gz'):
                    continue
                if file.startswith('.'):
                    # Keep important config files like .env.example, .gitignore
                    if file not in {'.env.example', '.gitignore'}:
                        continue

                abs_file_path = os.path.join(root, file)
                rel_path = os.path.relpath(abs_file_path, root_dir)
                
                zipf.write(abs_file_path, rel_path)
                file_count += 1
                
    print(f"Successfully archived {file_count} files into {target_zip} ({os.path.getsize(target_zip) / (1024*1024):.2f} MB)")
    return target_zip

if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'whatsapp-sender-project.zip'
    create_project_zip(out)
