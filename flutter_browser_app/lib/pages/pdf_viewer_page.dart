import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../sync_service.dart';

class PDFViewerPage extends StatefulWidget {
  final String? filePath;
  final String? fileUrl;
  final String? fileName;

  const PDFViewerPage({
    Key? key,
    this.filePath,
    this.fileUrl,
    this.fileName,
  }) : super(key: key);

  @override
  State<PDFViewerPage> createState() => _PDFViewerPageState();
}

class _PDFViewerPageState extends State<PDFViewerPage> {
  Uint8List? _pdfData;
  bool _isLoading = true;
  String? _error;
  String? _localPath;
  double _currentPage = 1;
  double _totalPages = 1;
  int _currentPageIndex = 0;
  final PageController _pageController = PageController();

  @override
  void initState() {
    super.initState();
    _loadPDF();
  }

  Future<void> _loadPDF() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      Uint8List? data;

      if (widget.filePath != null) {
        // Load from local file
        final file = File(widget.filePath!);
        if (await file.exists()) {
          data = await file.readAsBytes();
          _localPath = widget.filePath;
        } else {
          throw Exception('File not found');
        }
      } else if (widget.fileUrl != null) {
        // Download from URL
        data = await _downloadPDF(widget.fileUrl!);
      } else {
        throw Exception('No file path or URL provided');
      }

      setState(() {
        _pdfData = data;
        _isLoading = false;
        _currentPageIndex = 0;
        _currentPage = 1;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<Uint8List> _downloadPDF(String url) async {
    try {
      // Try to fetch from desktop HTTP server
      final isConnected = SyncService().isConnectedToDesktop;

      if (isConnected && url.startsWith('http://')) {
        final http = await HttpClient().getUrl(Uri.parse(url));
        final response = await http.close();
        final bytes = await consolidateByteBuffers(response);
        return bytes;
      }

      // Fallback - check if file exists locally
      final localPath = _getLocalPathFromUrl(url);
      if (localPath != null) {
        final file = File(localPath);
        if (await file.exists()) {
          return await file.readAsBytes();
        }
      }

      throw Exception('Could not download PDF');
    } catch (e) {
      throw Exception('Failed to download PDF: $e');
    }
  }

  Future<Uint8List> consolidateByteBuffers(HttpClientResponse response) async {
    final chunks = <List<int>>[];
    await for (final chunk in response) {
      chunks.add(chunk);
    }
    final totalLength = chunks.fold<int>(0, (sum, chunk) => sum + chunk.length);
    final result = Uint8List(totalLength);
    var offset = 0;
    for (final chunk in chunks) {
      result.setRange(offset, offset + chunk.length, chunk);
      offset += chunk.length;
    }
    return result;
  }

  String? _getLocalPathFromUrl(String url) {
    // Extract file name from URL and construct local path
    final uri = Uri.parse(url);
    final fileName = uri.pathSegments.isNotEmpty ? uri.pathSegments.last : null;
    if (fileName != null) {
      return '${SyncService().getConnectionInfo()['desktopIp']}/$fileName';
    }
    return null;
  }

  Future<void> _saveToDevice() async {
    if (_pdfData == null) return;

    try {
      final directory = await getApplicationDocumentsDirectory();
      final fileName = widget.fileName ??
          'document_${DateTime.now().millisecondsSinceEpoch}.pdf';
      final file = File('${directory.path}/$fileName');
      await file.writeAsBytes(_pdfData!);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Saved to ${file.path}')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to save: $e')),
        );
      }
    }
  }

  Future<void> _sharePDF() async {
    if (_pdfData == null) return;

    try {
      final directory = await getTemporaryDirectory();
      final fileName = widget.fileName ?? 'document.pdf';
      final file = File('${directory.path}/$fileName');
      await file.writeAsBytes(_pdfData!);

      await Share.shareXFiles(
        [XFile(file.path)],
        subject: widget.fileName ?? 'Shared PDF',
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to share: $e')),
        );
      }
    }
  }

  Future<void> _openInExternalApp() async {
    if (_localPath == null) {
      // Save first then open
      await _saveToDevice();
      return;
    }

    // Hand the file to whatever app the OS picks for it. On mobile the OS may
    // refuse file:// intents, so fall back to telling the user where it is.
    final savedMessage = 'Saved to $_localPath';
    try {
      final opened = await launchUrl(
        Uri.file(_localPath!),
        mode: LaunchMode.externalApplication,
      );
      if (!opened && mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(savedMessage)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(savedMessage)));
      }
    }
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Text(
          widget.fileName ?? 'PDF Viewer',
          style: const TextStyle(color: Colors.white, fontSize: 16),
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.download, color: Colors.white70),
            onPressed: _saveToDevice,
            tooltip: 'Save',
          ),
          IconButton(
            icon: const Icon(Icons.share, color: Colors.white70),
            onPressed: _sharePDF,
            tooltip: 'Share',
          ),
          IconButton(
            icon: const Icon(Icons.open_in_new, color: Colors.white70),
            onPressed: _openInExternalApp,
            tooltip: 'Open in External App',
          ),
        ],
      ),
      body: _buildBody(),
      bottomNavigationBar: _pdfData != null ? _buildBottomBar() : null,
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: Color(0xFF00E5FF)),
            SizedBox(height: 20),
            Text(
              'Loading PDF...',
              style: TextStyle(color: Colors.white54),
            ),
          ],
        ),
      );
    }

    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, size: 60, color: Colors.red),
            const SizedBox(height: 20),
            Text(
              'Failed to load PDF',
              style: const TextStyle(color: Colors.white, fontSize: 18),
            ),
            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 40),
              child: Text(
                _error!,
                style: const TextStyle(color: Colors.white54, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 30),
            ElevatedButton.icon(
              onPressed: _loadPDF,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF00E5FF),
                foregroundColor: Colors.black,
              ),
            ),
          ],
        ),
      );
    }

    if (_pdfData == null) {
      return const Center(
        child: Text(
          'No PDF data',
          style: TextStyle(color: Colors.white54),
        ),
      );
    }

    // Use PDF viewer - show as image representations since flutter pdf viewer might not be installed
    return _buildPDFDisplay();
  }

  Widget _buildPDFDisplay() {
    // Since we don't have a PDF rendering library, show placeholder
    // In production, you'd use flutter_pdfview or similar
    return Column(
      children: [
        Expanded(
          child: Container(
            margin: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.3),
                  blurRadius: 10,
                  offset: const Offset(0, 5),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: _buildPDFPlaceholder(),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                onPressed: _currentPageIndex > 0 ? _previousPage : null,
                icon: Icon(
                  Icons.chevron_left,
                  color: _currentPageIndex > 0 ? Colors.white : Colors.white24,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text(
                  'Page ${_currentPageIndex + 1}',
                  style: const TextStyle(color: Colors.white),
                ),
              ),
              IconButton(
                onPressed: _currentPageIndex < 9 ? _nextPage : null,
                icon: Icon(
                  Icons.chevron_right,
                  color: _currentPageIndex < 9 ? Colors.white : Colors.white24,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPDFPlaceholder() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.picture_as_pdf,
            size: 80,
            color: Colors.red.shade400,
          ),
          const SizedBox(height: 20),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              widget.fileName ?? 'PDF Document',
              style: const TextStyle(
                color: Colors.black87,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            '${(_pdfData!.length / 1024).toStringAsFixed(1)} KB',
            style: TextStyle(
              color: Colors.grey.shade600,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 30),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
            decoration: BoxDecoration(
              color: Colors.grey.shade200,
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.info_outline, size: 16, color: Colors.black54),
                SizedBox(width: 8),
                Text(
                  'Tap "Open in External App" to view full PDF',
                  style: TextStyle(color: Colors.black54, fontSize: 12),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color: Colors.grey.shade900,
        border: Border(
          top: BorderSide(color: Colors.white.withOpacity(0.1)),
        ),
      ),
      child: SafeArea(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _buildActionButton(
              icon: Icons.download,
              label: 'Save',
              onTap: _saveToDevice,
            ),
            _buildActionButton(
              icon: Icons.share,
              label: 'Share',
              onTap: _sharePDF,
            ),
            _buildActionButton(
              icon: Icons.fullscreen,
              label: 'Full View',
              onTap: _openInExternalApp,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withOpacity(0.05),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: const Color(0xFF00E5FF), size: 24),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(color: Colors.white70, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  void _previousPage() {
    if (_currentPageIndex > 0) {
      setState(() {
        _currentPageIndex--;
        _currentPage = _currentPageIndex + 1.0;
      });
      _pageController.previousPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  void _nextPage() {
    if (_currentPageIndex < 9) {
      setState(() {
        _currentPageIndex++;
        _currentPage = _currentPageIndex + 1.0;
      });
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }
}
