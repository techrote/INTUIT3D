// Pinned OCCT 8.0.1 one-shot plate/cut/STEP worker.
// Invoked only through the isolated, validated native/occt8_bridge.py host.
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <DESTEP_Parameters.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <UnitsMethods_LengthUnit.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <tuple>
#include <vector>
namespace {
struct Hole { double x,y,r; };
struct Request {
  std::string request_id,feature_id;
  long long revision=0;
  bool export_step=false;
  double width=0,depth=0,thickness=0;
  std::vector<Hole> holes;
};
struct Metrics {
  int solids=0,shells=0,faces=0; bool valid=false;
  double volume=0,area=0;
  std::vector<Hole> holes;std::vector<double> axes;
};
bool near(double a,double b) {
  return std::isfinite(a)&&std::isfinite(b)&&
    std::abs(a-b)<=std::max(1e-7,std::abs(b)*1e-10);
}
bool id_ok(const std::string& s) {
  if(s.empty()||s.size()>128||!std::isalpha(static_cast<unsigned char>(s[0])))return false;
  for(char c:s)if(!(std::isalnum(static_cast<unsigned char>(c))||
                    c=='.'||c==':'||c=='_'||c=='-'))return false;
  return true;
}
Request read_request(const std::filesystem::path& path) {
  std::ifstream file(path);
  std::string magic;Request q;int export_flag=-1,count=-1;
  if(!(file>>magic)||magic!="INTUIT3D_OCCT8_PLATE_V1"||
     !(file>>q.request_id>>q.feature_id>>q.revision>>export_flag>>
       q.width>>q.depth>>q.thickness>>count))
    throw std::runtime_error("invalid canonical request");
  if(!id_ok(q.request_id)||!id_ok(q.feature_id)||q.revision<0||
     export_flag<0||export_flag>1||count<0||count>64)
    throw std::runtime_error("invalid request identity or hole count");
  q.export_step=(export_flag==1);
  const auto dimension=[](double v) {return std::isfinite(v)&&v>=1e-6&&v<=1e6;};
  if(!dimension(q.width)||!dimension(q.depth)||!dimension(q.thickness))
    throw std::runtime_error("invalid plate dimensions");
  for(int i=0;i<count;++i) {
    Hole h{};
    if(!(file>>h.x>>h.y>>h.r)||!std::isfinite(h.x)||!std::isfinite(h.y)||
       !dimension(h.r)||!(std::abs(h.x)+h.r<q.width/2)||
       !(std::abs(h.y)+h.r<q.depth/2))
      throw std::runtime_error("invalid or tangent hole");
    for(const auto& earlier:q.holes)
      if(std::hypot(h.x-earlier.x,h.y-earlier.y)<=h.r+earlier.r)
        throw std::runtime_error("overlapping holes");
    q.holes.push_back(h);
  }
  std::string extra;
  if(file>>extra)throw std::runtime_error("trailing request data");
  return q;
}
int count(const TopoDS_Shape& s,TopAbs_ShapeEnum kind) {
  int n=0;for(TopExp_Explorer ex(s,kind);ex.More();ex.Next())++n;return n;
}
Metrics inspect(const TopoDS_Shape& s) {
  if(s.IsNull())throw std::runtime_error("null B-rep");
  Metrics m;
  m.valid=BRepCheck_Analyzer(s).IsValid();
  m.solids=count(s,TopAbs_SOLID);m.shells=count(s,TopAbs_SHELL);
  m.faces=count(s,TopAbs_FACE);
  GProp_GProps v,a;
  BRepGProp::VolumeProperties(s,v);BRepGProp::SurfaceProperties(s,a);
  m.volume=v.Mass();m.area=a.Mass();
  std::vector<std::pair<Hole,double>> found;
  for(TopExp_Explorer ex(s,TopAbs_FACE);ex.More();ex.Next()){
    BRepAdaptor_Surface adaptor(TopoDS::Face(ex.Current()),true);
    if(adaptor.GetType()==GeomAbs_Cylinder){
      auto cylinder=adaptor.Cylinder();
      auto centre=cylinder.Position().Location();
      found.push_back({{centre.X(),centre.Y(),cylinder.Radius()},
                       cylinder.Position().Direction().Z()});
    }else if(adaptor.GetType()!=GeomAbs_Plane)
      throw std::runtime_error("unsupported extra curved face");
  }
  std::sort(found.begin(),found.end(),[](const auto& a,const auto& b) {
    return std::tie(a.first.x,a.first.y,a.first.r)<
           std::tie(b.first.x,b.first.y,b.first.r);
  });
  for(const auto& f:found){m.holes.push_back(f.first);m.axes.push_back(f.second);}
  return m;
}
void require_shape(const Request& q,const Metrics& m) {
  double removed_area=0,bore_wall=0;
  for(const auto& h:q.holes) {
    removed_area+=std::acos(-1.0)*h.r*h.r;
    bore_wall+=2*std::acos(-1.0)*h.r;
  }
  const double v=(q.width*q.depth-removed_area)*q.thickness;
  const double a=2*(q.width*q.depth-removed_area)+
       (2*(q.width+q.depth)+bore_wall)*q.thickness;
  if(!m.valid||m.solids!=1||m.shells!=1||
     m.faces!=6+static_cast<int>(q.holes.size())||
     m.holes.size()!=q.holes.size()||
     !near(m.volume,v)||!near(m.area,a))
    throw std::runtime_error("B-rep topology or mass does not match plate intent");
  auto expected=q.holes;
  std::sort(expected.begin(),expected.end(),[](const Hole& a,const Hole& b) {
    return std::tie(a.x,a.y,a.r)<std::tie(b.x,b.y,b.r);
  });
  for(std::size_t i=0;i<expected.size();++i){
    const auto& e=expected[i];const auto& h=m.holes[i];
    if(std::abs(e.x-h.x)>std::max(1e-11,std::abs(e.x)*1e-9)||
       std::abs(e.y-h.y)>std::max(1e-11,std::abs(e.y)*1e-9)||
       std::abs(e.r-h.r)>std::max(1e-11,std::abs(e.r)*1e-9)||
       std::abs(std::abs(m.axes[i])-1)>1e-10)
      throw std::runtime_error("cylindrical through-hole was lost or displaced");
  }
}
TopoDS_Shape construct(const Request& q) {
  TopoDS_Shape shape=BRepPrimAPI_MakeBox(
     gp_Pnt(-q.width/2,-q.depth/2,0),q.width,q.depth,q.thickness).Shape();
  for(const auto& h:q.holes){
    const auto tool=BRepPrimAPI_MakeCylinder(
      gp_Ax2(gp_Pnt(h.x,h.y,-q.thickness),gp_Dir(0,0,1)),
      h.r,3*q.thickness).Shape();
    BRepAlgoAPI_Cut cut(shape,tool);
    cut.SetFuzzyValue(0.0); // Never silently relax modelling tolerance.
    cut.SetRunParallel(false);
    cut.Build();
    if(!cut.IsDone()||cut.HasErrors()||cut.Shape().IsNull())
      throw std::runtime_error("OCCT cut failed");
    shape=cut.Shape();
  }
  return shape;
}
std::string metrics_json(const Metrics& m) {
  std::ostringstream s;s<<std::setprecision(17)
    <<"{\"valid\":"<<(m.valid?"true":"false")
    <<",\"solidCount\":"<<m.solids
    <<",\"volumeMm3\":"<<m.volume
    <<",\"surfaceAreaMm2\":"<<m.area
    <<",\"cylindricalHoles\":[";
  for(std::size_t i=0;i<m.holes.size();++i){
    if(i)s<<',';
    s<<"{\"x\":"<<m.holes[i].x<<",\"y\":"<<m.holes[i].y
      <<",\"radius\":"<<m.holes[i].r<<",\"axisZ\":"<<m.axes[i]<<"}";
  }
  return s.str()+"]}";
}
void write_report(const Request& q,const Metrics& source,
                  const Metrics* step,const std::filesystem::path& output) {
  // IDs have already been restricted to JSON-safe alphanumeric characters.
  std::ostringstream s;
  s<<"{\"protocol\":\"intuit3d/kernel/plate-v1\",\"requestId\":\""
   <<q.request_id<<"\",\"featureId\":\""<<q.feature_id
   <<"\",\"revision\":"<<q.revision
   <<",\"backend\":\"OCCT-cxx-8.0.1\",\"occtVersion\":\"8.0.1\""
   <<",\"status\":\"validated_exact\",\"units\":\"mm\",\"source\":"
   <<metrics_json(source)<<",\"stepReadback\":";
  if(step)s<<metrics_json(*step);else s<<"null";
  s<<",\"stepWritten\":"<<(step?"true":"false")<<"}";
  auto pending=output.string()+".pending";
  std::ofstream file(pending,std::ios::binary|std::ios::trunc);
  if(!file||!(file<<s.str()))throw std::runtime_error("response write failed");
  file.close();if(!file)throw std::runtime_error("response flush failed");
  std::filesystem::rename(pending,output);
}
}
int main(int argc,char** argv) {
  try {
    if(argc!=4)throw std::runtime_error("expected: canonical.request response.json step.step");
    if(std::string(OCC_VERSION_COMPLETE)!="8.0.1")
      throw std::runtime_error("not compiled against OCCT 8.0.1");
    auto q=read_request(argv[1]);
    auto shape=construct(q);
    auto src=inspect(shape);require_shape(q,src);
    Metrics rb;Metrics* readback=nullptr;
    if(q.export_step) {
      DESTEP_Parameters p;
      p.WriteUnit=UnitsMethods_LengthUnit_Millimeter;
      STEPControl_Writer writer;
      if(writer.Transfer(shape,STEPControl_ManifoldSolidBrep,p,true)!=IFSelect_RetDone||
         writer.Write(argv[3])!=IFSelect_RetDone)
        throw std::runtime_error("STEP export failed");
      STEPControl_Reader reader;
      if(reader.ReadFile(argv[3])!=IFSelect_RetDone||reader.TransferRoots()!=1)
        throw std::runtime_error("same-engine STEP reimport failed");
      rb=inspect(reader.OneShape());require_shape(q,rb);readback=&rb;
    }
    write_report(q,src,readback,argv[2]);
    return 0;
  }catch(const Standard_Failure& e) {
    std::cerr<<"OCCT worker: "<<e.GetMessageString()<<'\n';return 2;
  }catch(const std::exception& e) {
    std::cerr<<"OCCT worker: "<<e.what()<<'\n';return 2;
  }
}
